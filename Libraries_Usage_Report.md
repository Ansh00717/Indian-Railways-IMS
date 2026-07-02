# Detailed Libraries Usage Report

This document outlines every significant library and framework used in your project, breaking down **what** it is, **where** it is used, and **why** it was chosen over alternatives.

---

## 1. Frontend Core & UI

| Library | Purpose | Why it exists in the project |
| :--- | :--- | :--- |
| **react** / **react-dom** | UI Framework | The foundation of the frontend SPA (Single Page Application). Chosen for its component-based architecture which makes building modular UI (like Modals, Dashboards, and Lists) highly efficient. |
| **react-router-dom** | Client-side Routing | Enables seamless navigation between the Login, Dashboard, Upload, and Receipt Detail pages without triggering full page reloads, providing a fast native-app feel. |
| **tailwindcss** | Styling System | A utility-first CSS framework. Used instead of writing custom CSS files for rapid UI development, consistent theming, and responsive design. |
| **lucide-react** | SVG Iconography | Provides the clean, modern vector icons seen throughout the UI (e.g., upload arrows, checkmarks, user icons). Chosen for its lightweight footprint and clean aesthetics. |
| **motion** (Framer Motion) | Animation Library | Handles the smooth transitions, micro-interactions, and page-load animations. Chosen to give the application a premium, dynamic feel. |
| **clsx** & **tailwind-merge** | Class Merging Utilities | Often used together (usually wrapped in a `cn()` utility) to conditionally apply Tailwind classes without styling conflicts. |

---

## 2. Backend Server & API

| Library | Purpose | Why it exists in the project |
| :--- | :--- | :--- |
| **express** | Web Server | The core backend framework in Node.js. It handles API routing, parsing incoming requests, and acting as a reverse proxy for the Django CAPTCHA service. |
| **multer** | File Upload Handling | Specifically designed to handle `multipart/form-data`. It safely parses the incoming PDF files uploaded from the React frontend into memory buffers so the OCR pipeline can process them. |
| **dotenv** | Environment Configuration | Loads variables from `.env` into `process.env`. Critical for keeping secrets (like `JWT_SECRET`, `GEMINI_API_KEY`, and DB passwords) out of the source code. |
| **date-fns** | Date Manipulation | A modern, tree-shakeable alternative to Moment.js. Used to reliably format, parse, and compare dates extracted from receipts or database timestamps. |

---

## 3. Database & ORM

| Library | Purpose | Why it exists in the project |
| :--- | :--- | :--- |
| **drizzle-orm** & **drizzle-kit** | SQL ORM & Migrations | Drizzle provides type-safe database queries. It ensures that the TypeScript types match the actual PostgreSQL schema exactly. Chosen over Prisma for its raw SQL-like syntax and lack of a heavy Rust binary overhead. |
| **pg** | PostgreSQL Client | The underlying database driver that allows Node.js to connect to and communicate with the PostgreSQL server. |

---

## 4. Security & Authentication

| Library | Purpose | Why it exists in the project |
| :--- | :--- | :--- |
| **bcryptjs** | Password Hashing | Safely hashes user passwords and security question answers before storing them in the database. Chosen because it's a pure JavaScript implementation of bcrypt, avoiding native compilation issues. |
| **jsonwebtoken** (JWT) | Stateless Authentication | Generates secure tokens upon login. Instead of storing sessions in the database, the backend verifies the JWT on protected routes to ensure the user is authorized. |
| **qrcode** | QR Code Generation | Generates the 2D QR images for approved receipts. Chosen because it can output directly to a Base64 Data URL, allowing the frontend to render the QR code instantly without saving images to the disk. |

---

## 5. OCR & PDF Processing (TypeScript)

| Library | Purpose | Why it exists in the project |
| :--- | :--- | :--- |
| **pdf-parse** | Digital Text Extraction | Extremely fast library to extract native text layers from digitally created PDFs. Used as the highly efficient "Strategy A" in your OCR pipeline. |
| **@google/genai** | AI Semantic Parsing | The official SDK for the Gemini API. Used to take raw OCR text and logically map it into strict JSON structures. Chosen over regex for its ability to handle immense variations in receipt layouts. |
| **tesseract.js** | Optical Character Recognition | *Note:* While this is in the `package.json`, your `server.ts` is actually utilizing the native executable (`tesseract.exe`) via `child_process`. It exists as a fallback to read scanned images when `pdf-parse` fails to find text. |
| **pdfjs-dist** | PDF Rendering | Mozilla's core PDF library. Typically used to render PDF pages in the browser or extract metadata. |

---

## 6. Build Tools & Transpilers

| Library | Purpose | Why it exists in the project |
| :--- | :--- | :--- |
| **vite** | Bundler & Dev Server | Replaces Create React App / Webpack. Chosen for its near-instant Hot Module Replacement (HMR) and rapid build speeds for the React frontend. |
| **typescript** | Static Typing | Adds strict typing to JavaScript. Catches bugs at compile-time (like passing a string to a function expecting a number) rather than runtime. |
| **esbuild** & **tsx** | Node Execution | `esbuild` bundles your backend `server.ts` into a fast, runnable production file. `tsx` runs TypeScript files natively during development without needing pre-compilation. |

---

## 7. Python Captcha Microservice (`requirements.txt`)

*Note: You have a separate Python environment primarily used for the CAPTCHA service. Many of the PDF tools here are likely leftovers from early experimentation before the logic moved to TypeScript.*

| Library | Purpose | Why it exists in the project |
| :--- | :--- | :--- |
| **Django** | Python Web Framework | The framework hosting the CAPTCHA service. |
| **django-simple-captcha** *(implicit via usage)* | Captcha Generation | Generates the challenge images and validates user input to prevent brute-force attacks. |
| **pytesseract, pdfplumber, PyMuPDF, pdf2image** | Python OCR / PDF tools | These exist in `requirements.txt` but are unused by the current production flow. They were likely used in `src/python/extract_text.py` during early prototyping phases. |
| **psycopg2-binary** | PostgreSQL adapter | Allows the Django application to connect to PostgreSQL. |
