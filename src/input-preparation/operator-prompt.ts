import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import type { PreparedInputDescriptor } from ".";
import {
  consumeRuntimeLoginInputs,
  InMemoryRuntimeSecretProvider,
  RuntimeLoginError,
  validateRuntimeLoginRequest,
  type RuntimeLoginAccount,
  type RuntimeLoginRequest,
  type RuntimeLoginResult,
} from "./runtime-login";

export interface OperatorTerminalInput extends Readable {
  readonly isTTY: boolean;
  readonly isRaw: boolean;
  setRawMode(mode: boolean): unknown;
}

export interface OperatorTerminalOutput extends Writable {
  readonly isTTY: boolean;
}

const activeTerminals = new WeakSet<OperatorTerminalInput>();

function readHiddenLine(
  input: OperatorTerminalInput,
  output: OperatorTerminalOutput,
  label: string,
  expiresAt: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!input.isTTY || !output.isTTY || signal?.aborted) {
    throw new RuntimeLoginError("runtime-input-unavailable");
  }
  return new Promise((resolve, reject) => {
    let value = "";
    const decoder = new StringDecoder("utf8");
    let settled = false;
    const timeout = setTimeout(
      () => finish(new RuntimeLoginError("expired-runtime-input")),
      Math.max(0, expiresAt - Date.now()),
    );
    const finish = (error?: RuntimeLoginError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.removeListener("data", onData);
      input.removeListener("end", onUnavailable);
      input.removeListener("error", onUnavailable);
      output.removeListener("error", onUnavailable);
      signal?.removeEventListener("abort", onUnavailable);
      let cleanupFailed = false;
      try {
        input.pause();
        output.write("\n");
      } catch {
        cleanupFailed = true;
      }
      const result = value;
      value = "";
      if (error || cleanupFailed)
        reject(error ?? new RuntimeLoginError("runtime-input-unavailable"));
      else resolve(result);
    };
    const onUnavailable = () =>
      finish(new RuntimeLoginError("runtime-input-unavailable"));
    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
      for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character === "\r" || character === "\n") {
          if (index !== text.length - 1 || value.trim().length === 0)
            finish(new RuntimeLoginError("invalid-runtime-input"));
          else finish();
          return;
        }
        if (character === "\u0003" || character === "\u0004") {
          onUnavailable();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = Array.from(value).slice(0, -1).join("");
        } else if (character < " " || character === "\u001b") {
          finish(new RuntimeLoginError("invalid-runtime-input"));
          return;
        } else {
          value += character;
        }
        if (value.length > 1024) {
          finish(new RuntimeLoginError("invalid-runtime-input"));
          return;
        }
      }
    };
    input.on("data", onData);
    input.once("end", onUnavailable);
    input.once("error", onUnavailable);
    output.once("error", onUnavailable);
    signal?.addEventListener("abort", onUnavailable, { once: true });
    try {
      output.write(label);
      input.resume();
    } catch {
      onUnavailable();
    }
  });
}

/** No stdin-pipe, environment-variable, file, or command-argument fallback. */
export async function withOperatorLoginInputs(
  descriptor: PreparedInputDescriptor,
  request: RuntimeLoginRequest,
  consume: (account: RuntimeLoginAccount) => Promise<void>,
  options: {
    readonly input?: OperatorTerminalInput;
    readonly output?: OperatorTerminalOutput;
    readonly signal?: AbortSignal;
  } = {},
): Promise<RuntimeLoginResult> {
  const reviewed = validateRuntimeLoginRequest(descriptor, request);
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stderr;
  if (
    !input.isTTY ||
    !output.isTTY ||
    input.listenerCount("data") !== 0 ||
    input.isRaw ||
    activeTerminals.has(input)
  ) {
    throw new RuntimeLoginError("runtime-input-unavailable");
  }
  let username = "";
  let password = "";
  let provider: InMemoryRuntimeSecretProvider | undefined;
  const wasFlowing = input.readableFlowing === true;
  activeTerminals.add(input);
  try {
    try {
      try {
        input.setRawMode(true);
      } catch {
        throw new RuntimeLoginError("runtime-input-unavailable");
      }
      username = await readHiddenLine(
        input,
        output,
        "Login account (hidden): ",
        reviewed.expiresAt,
        options.signal,
      );
      password = await readHiddenLine(
        input,
        output,
        "Login password (hidden): ",
        reviewed.expiresAt,
        options.signal,
      );
    } finally {
      try {
        input.setRawMode(false);
        if (wasFlowing) input.resume();
        else input.pause();
      } catch {
        throw new RuntimeLoginError("runtime-input-unavailable");
      }
    }
    if (options.signal?.aborted)
      throw new RuntimeLoginError("runtime-input-unavailable");
    validateRuntimeLoginRequest(descriptor, reviewed);
    provider = new InMemoryRuntimeSecretProvider(reviewed, {
      username,
      password,
    });
    username = "";
    password = "";
    return await consumeRuntimeLoginInputs(
      descriptor,
      reviewed,
      provider,
      consume,
    );
  } finally {
    activeTerminals.delete(input);
    provider?.dispose();
    username = "";
    password = "";
  }
}
