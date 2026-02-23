---
"ripple": patch
---

Fix hydration failure for HTML `<template>` elements containing dynamic content

The browser automatically moves `<template>` element children into the `.content` DocumentFragment property. During hydration, the runtime now correctly accesses `.content` when descending into template elements, preventing hydration mismatches when using `{html ...}` directives inside `<template>` tags.
