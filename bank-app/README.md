# Northstar Credit Union Bank App

Northstar Credit Union is a mock employee-facing banking application built as a target for browser automation and AI-agent experiments. It provides a realistic member-servicing UI, a REST API, persistent SQLite data, and deterministic failure scenarios.

All members, accounts, balances, and transactions in this project are fictitious.

## Features

- Simulated employee login
- Member search and member details
- Account search, balances, and account details
- Reviewed workflows for creating members and sub-accounts
- SQLite persistence for members and accounts
- Static recent-transaction data for UI testing
- Admin-controlled slow responses and HTTP failures
- Stable seeded records for repeatable automation tasks

The initial agent milestone supported by the app is:

> Look up member `12345` and return the available balance of their savings account.

For a freshly seeded database, the expected answer is **$4,281.50**.

## Architecture

```text
React + TypeScript + Vite
            |
            | HTTP
            v
         FastAPI
            |
            v
       SQLAlchemy
            |
            v
          SQLite
```

The frontend calls `http://localhost:8001`. The backend permits browser requests from `http://localhost:5174`, so use the ports shown below when running the app.

## Prerequisites

- Node.js and npm
- Python 3.10 or newer

## Run locally

Open two terminals from the `bank-app` directory.

### 1. Start the backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8001
```

The API will be available at:

- Health check: `http://localhost:8001/api/health`
- Interactive API docs: `http://localhost:8001/docs`

### 2. Start the frontend

```bash
npm ci
npm run dev -- --port 5174
```

Open `http://localhost:5174`. Any non-empty employee ID and password will pass the simulated login screen.

## Seed data

The backend creates the database tables and inserts baseline data at startup when the member table is empty.

| Member ID | Member | Account | Available balance | Current balance |
| --- | --- | --- | ---: | ---: |
| `12345` | John Smith | Savings `****4521` | $4,281.50 | $4,356.22 |
| `12345` | John Smith | Checking `****1883` | $1,024.19 | $1,024.19 |
| `12345` | John Smith | Loan `****9912` | -$8,200.00 | -$8,200.00 |
| `23456` | Sarah Johnson | Savings `****7721` | $8,370.25 | $8,370.25 |

New members and accounts are saved in `backend/data/bank.db`. To restore the baseline data, stop the backend, delete that file, and restart the backend:

```bash
rm backend/data/bank.db
```

## Main application routes

| Route | Purpose |
| --- | --- |
| `/login` | Simulated employee sign-in |
| `/dashboard` | Operations landing page |
| `/members` | Search for a member |
| `/members/new` | Start the reviewed member-creation flow |
| `/members/:memberId` | View a member and their accounts |
| `/members/:memberId/accounts/:accountId` | View account details and balances |
| `/members/:memberId/accounts/new` | Start the reviewed sub-account flow |
| `/accounts` | Find accounts by member number |
| `/transactions` | View static example transactions |
| `/admin` | Select a deterministic runtime scenario |

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check API health |
| `GET` | `/api/members/{member_id}` | Get a member and their accounts |
| `POST` | `/api/members` | Create a member |
| `GET` | `/api/members/{member_id}/accounts` | List a member's accounts |
| `GET` | `/api/members/{member_id}/accounts/{account_id}` | Get one account |
| `POST` | `/api/members/{member_id}/accounts/preview` | Validate and preview a new account |
| `POST` | `/api/members/{member_id}/accounts` | Create a new account |
| `GET` | `/api/admin/scenario` | Read the active simulation mode |
| `PUT` | `/api/admin/scenario` | Change the simulation mode |

## Failure simulation

Use the Admin page to select a scenario. The active scenario is held in backend memory and returns to `NORMAL` whenever the backend restarts.

| Scenario | Behavior on guarded member/account requests |
| --- | --- |
| `NORMAL` | Requests run normally |
| `SLOW_RESPONSE` | The backend waits five seconds before responding |
| `PERMISSION_DENIED` | Returns HTTP 403 with `PERMISSION_DENIED` |
| `SESSION_EXPIRED` | Returns HTTP 401 with `SESSION_EXPIRED`; the UI redirects to sign-in |
| `APP_ERROR` | Returns HTTP 500 with `APPLICATION_ERROR` |
| `SUPERVISOR_APPROVAL` | Reserved for a future human-approval workflow; currently behaves normally |

## Project structure

```text
bank-app/
├── src/
│   ├── components/       Shared header, navigation, and layout
│   ├── pages/            Routed application screens
│   ├── services/         Fetch wrappers for backend APIs
│   ├── styles/           Global application styling
│   ├── types/            Shared frontend data types
│   ├── App.tsx           Route definitions
│   └── main.tsx          React entry point
├── backend/
│   ├── app/
│   │   ├── api/          FastAPI member, account, and admin routes
│   │   ├── db/           SQLAlchemy configuration and seed data
│   │   ├── demo/         Runtime scenario state and behavior
│   │   ├── models/       SQLAlchemy models
│   │   ├── schemas/      Pydantic request and response models
│   │   └── main.py       FastAPI entry point
│   ├── data/             Runtime SQLite database
│   └── requirements.txt  Python dependencies
├── package.json          Frontend dependencies and scripts
└── vite.config.ts        Vite configuration
```

## Frontend scripts

| Command | Purpose |
| --- | --- |
| `npm run dev -- --port 5174` | Start the development server on the CORS-enabled port |
| `npm run build` | Type-check and create a production build |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview the production build |

## Current limitations

- Login is a frontend-only simulation; there are no users, sessions, or authorization checks.
- Transactions are static UI data and are not stored in SQLite.
- The supervisor-approval scenario is a placeholder for the future human-in-the-loop system.
- The frontend API URL and allowed frontend origin are configured directly in source code.
