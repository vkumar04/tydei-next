# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: vendor-pages.test.ts >> vendor renewals page loads
- Location: tests/visual/vendor-pages.test.ts:94:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: apiRequestContext._wrapApiCall: ENOENT: no such file or directory, copyfile '/Users/vickkumar/code/tydei-next/test-results/.playwright-artifacts-8/traces/34726e3650be5b1132d3-b888bcb53f9475ee0a07.network' -> '/Users/vickkumar/code/tydei-next/test-results/.playwright-artifacts-8/traces/34726e3650be5b1132d3-b888bcb53f9475ee0a07-pwnetcopy-1.network'
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - img [ref=e7]
      - generic [ref=e10]:
        - heading "TYDEi" [level=1] [ref=e11]
        - paragraph [ref=e12]: Platform
    - generic [ref=e13]:
      - generic [ref=e14]:
        - generic [ref=e15]: Welcome back
        - generic [ref=e16]: Sign in to access your contract management dashboard
      - generic [ref=e18]:
        - generic [ref=e19]:
          - generic [ref=e20]: Email
          - textbox "Email" [ref=e21]:
            - /placeholder: you@example.com
        - generic [ref=e22]:
          - generic [ref=e23]: Password
          - textbox "Password" [ref=e24]
        - button "Sign in" [ref=e26]
        - generic [ref=e28]:
          - generic [ref=e33]: Or
          - generic [ref=e34]:
            - button "Facility Demo" [ref=e36]
            - button "Vendor Demo" [ref=e38]
        - paragraph [ref=e39]:
          - text: Don't have an account?
          - link "Contact your administrator" [ref=e40] [cursor=pointer]:
            - /url: /auth/sign-up
    - paragraph [ref=e41]: By signing in, you agree to our Terms of Service and Privacy Policy
    - link "Operator/Admin Portal" [ref=e43] [cursor=pointer]:
      - /url: /admin
  - region "Notifications alt+T"
  - button "Open Next.js Dev Tools" [ref=e49] [cursor=pointer]:
    - img [ref=e50]
  - alert [ref=e53]
```