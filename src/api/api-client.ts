/**
 * API client for making HTTP requests during tests
 */

import { APIRequestContext, request } from "@playwright/test";
import { Logger } from "@utils/logger";

export interface ApiResponse<T = any> {
  status: number;
  headers: Record<string, string>;
  data: T;
  ok: boolean;
}

export class ApiClient {
  private context: APIRequestContext | null = null;
  private baseURL: string;
  private defaultHeaders: Record<string, string>;
  private logger: Logger;

  constructor(baseURL: string, defaultHeaders: Record<string, string> = {}) {
    this.baseURL = baseURL;
    this.defaultHeaders = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...defaultHeaders,
    };
    this.logger = new Logger("ApiClient");
  }

  /**
   * Initialize API context
   */
  async init(): Promise<void> {
    this.context = await request.newContext({
      baseURL: this.baseURL,
      extraHTTPHeaders: this.defaultHeaders,
    });
    this.logger.info(`API client initialized with baseURL: ${this.baseURL}`);
  }

  /**
   * Dispose API context
   */
  async dispose(): Promise<void> {
    if (this.context) {
      await this.context.dispose();
      this.context = null;
      this.logger.info("API client disposed");
    }
  }

  /**
   * Set authentication token
   */
  setAuthToken(token: string): void {
    this.defaultHeaders["Authorization"] = `Bearer ${token}`;
    this.logger.info("Authentication token set");
  }

  /**
   * Clear authentication token
   */
  clearAuthToken(): void {
    delete this.defaultHeaders["Authorization"];
    this.logger.info("Authentication token cleared");
  }

  /**
   * Make GET request
   */
  async get<T = any>(
    url: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    return this.makeRequest<T>("GET", url, options);
  }

  /**
   * Make POST request
   */
  async post<T = any>(
    url: string,
    data?: any,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    return this.makeRequest<T>("POST", url, { ...options, data });
  }

  /**
   * Make PUT request
   */
  async put<T = any>(
    url: string,
    data?: any,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    return this.makeRequest<T>("PUT", url, { ...options, data });
  }

  /**
   * Make PATCH request
   */
  async patch<T = any>(
    url: string,
    data?: any,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    return this.makeRequest<T>("PATCH", url, { ...options, data });
  }

  /**
   * Make DELETE request
   */
  async delete<T = any>(
    url: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    return this.makeRequest<T>("DELETE", url, options);
  }

  /**
   * Upload file
   */
  async uploadFile<T = any>(
    url: string,
    filePath: string,
    fieldName: string = "file",
    additionalData: Record<string, any> = {},
  ): Promise<ApiResponse<T>> {
    if (!this.context) {
      throw new Error("API client not initialized");
    }

    const formData = {
      [fieldName]: require("fs").createReadStream(filePath),
      ...additionalData,
    };

    this.logger.info(`Uploading file to ${url}`);
    const response = await this.context.post(url, {
      multipart: formData,
    });

    return this.processResponse<T>(response);
  }

  /**
   * Make raw request
   */
  private async makeRequest<T>(
    method: string,
    url: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    if (!this.context) {
      throw new Error("API client not initialized");
    }

    const { headers = {}, data, params, timeout } = options;
    const mergedHeaders = { ...this.defaultHeaders, ...headers };

    this.logger.info(`Making ${method} request to ${url}`);

    const requestOptions: any = {
      headers: mergedHeaders,
      timeout: timeout || 30000,
    };

    if (data) {
      requestOptions.data = data;
    }

    if (params) {
      const searchParams = new URLSearchParams(params);
      url += (url.includes("?") ? "&" : "?") + searchParams.toString();
    }

    let response;
    switch (method.toUpperCase()) {
      case "GET":
        response = await this.context.get(url, requestOptions);
        break;
      case "POST":
        response = await this.context.post(url, requestOptions);
        break;
      case "PUT":
        response = await this.context.put(url, requestOptions);
        break;
      case "PATCH":
        response = await this.context.patch(url, requestOptions);
        break;
      case "DELETE":
        response = await this.context.delete(url, requestOptions);
        break;
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }

    return this.processResponse<T>(response);
  }

  /**
   * Process response
   */
  private async processResponse<T>(response: any): Promise<ApiResponse<T>> {
    const status = response.status();
    const headers = response.headers();
    const ok = response.ok();

    let data: T;
    try {
      const contentType = headers["content-type"] || "";
      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        data = (await response.text()) as any;
      }
    } catch (error) {
      this.logger.warn("Failed to parse response body", error as Error);
      data = null as any;
    }

    this.logger.info(`Response: ${status} ${ok ? "OK" : "ERROR"}`);

    if (!ok) {
      this.logger.error(
        `API request failed: ${status}`,
        new Error(JSON.stringify(data)),
      );
    }

    return {
      status,
      headers,
      data,
      ok,
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.get("/health");
      return response.ok;
    } catch (error) {
      this.logger.error("Health check failed", error as Error);
      return false;
    }
  }

  /**
   * Wait for API to be ready
   */
  async waitForApiReady(
    maxAttempts: number = 10,
    delay: number = 2000,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.logger.info(
        `Checking API readiness (attempt ${attempt}/${maxAttempts})`,
      );

      if (await this.healthCheck()) {
        this.logger.info("API is ready");
        return;
      }

      if (attempt < maxAttempts) {
        this.logger.info(`API not ready, waiting ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error("API failed to become ready within timeout");
  }
}

interface RequestOptions {
  headers?: Record<string, string>;
  data?: any;
  params?: Record<string, string>;
  timeout?: number;
}
