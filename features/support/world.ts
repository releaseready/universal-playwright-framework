import type { Browser, Page } from "@playwright/test";

export interface SyntheticWorld {
  browser: Browser;
  baseUrl: string;
  page?: Page;
}
