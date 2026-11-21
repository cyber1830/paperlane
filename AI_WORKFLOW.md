# AI workflow

I used the Claude as a coding and review assistant while working on this assignment.

## Where it helped

It helped me compare the implementation with the assignment requirements, inspect the document, upload, and sharing flows, and spot delivery gaps. It also helped identify that the test command used Unix-style environment-variable syntax and would not run as written on Windows.

## What I changed or rejected

 I kept the existing lightweight approach—React, Express, SQLite, and a content-editable editor—instead of adding a larger editor framework or external service. I also updated the test script to work across platforms and reformatted the source for readability.

## How I verified the work

I ran the API test covering document access, sharing permissions, title validation, and HTML sanitization, and built the production frontend with Vite. I did not perform a browser-based manual UX test during this update, so the interface should still be exercised manually before submission.
