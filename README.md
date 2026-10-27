# 🎯 Universal Playwright E2E Testing Framework

A **production-ready**, **plug-and-play** end-to-end testing framework built with Playwright and TypeScript.

**� Use this framework for ANY web application** - simply add as a submodule and start testing in minutes!

## ⚡ 5-Minute Setup for Any Project

```bash
# 1. Add framework to your project
git submodule add <framework-repo-url> test-frameworks/playwright-framework

# 2. Install and setup
cd test-frameworks/playwright-framework
npm install && npx playwright install

# 3. Configure for your app
echo 'BASE_URL=http://localhost:3000' > .env  # Your app's URL

# 4. Run example tests
npm run test

# 5. Create your first test (copy and customize example-app.spec.ts)
```

**That's it! You now have professional E2E testing for your app.** 🎉

## Standalone synthetic Cucumber scenario

Run the local, assertion-backed Gherkin + Playwright example without an application account or external target. See the [synthetic Cucumber setup and results guide](docs/synthetic-cucumber.md).

## Reviewed synthetic execution adapter

Run reviewed scenarios with bounded, isolated local browser sessions. See the [synthetic execution guide](docs/synthetic-execution.md).
