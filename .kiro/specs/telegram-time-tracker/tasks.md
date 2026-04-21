# Implementation Plan: Telegram Time Tracker

## Overview

Implement a Telegram bot for employee time tracking built on Next.js 14+ (App Router), TypeScript, Supabase (PostgreSQL + Storage), and deployed to Vercel. The implementation follows a bottom-up dependency order: database schema → shared types → infrastructure clients → services → handlers → webhook route. Property-based tests (fast-check) are placed close to the code they validate.

## Tasks

- [x] 1. Project scaffolding and environment setup
  - Initialise a Next.js 14+ project with TypeScript (`npx create-next-app@latest --typescript`)
  - Install runtime dependencies: `@supabase/supabase-js`, `fast-check` (dev), `vitest` (dev), `@vitest/coverage-v8` (dev)
  - Create the folder structure: `src/app/api/telegram/webhook/`, `src/lib/telegram/`, `src/lib/services/`, `src/lib/handlers/`, `src/lib/db/`, `src/lib/utils/`, `src/types/`
  - Create `.env.local` with placeholder keys: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `NEXT_PUBLIC_APP_URL`
  - Add `vitest.config.ts` configured for the `src/` directory
  - _Requirements: 15.1_

- [x] 2. Database schema and Supabase client
  - [x] 2.1 Write `src/lib/db/schema.sql` with the full DDL
    - Create `users`, `projects`, `tasks`, `time_logs`, `attachments`, `sessions` tables as specified in the design
    - Include all indexes, CHECK constraints, and `ON DELETE CASCADE` foreign keys
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

  - [x] 2.2 Write `src/lib/db/types.ts` with database row types
    - Export `UserRow`, `ProjectRow`, `TaskRow`, `TimeLogRow`, `AttachmentRow`, `SessionRow` interfaces matching schema columns
    - _Requirements: 14.1–14.7_

  - [x] 2.3 Write `src/lib/db/client.ts` — Supabase client singleton
    - Instantiate `createClient` with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `process.env`
    - Export a single `supabase` instance for server-side use only
    - _Requirements: 15.1, 15.4_

- [x] 3. Shared TypeScript types
  - Write `src/types/index.ts` with all domain interfaces from the design
  - Include: `UserRole`, `TaskStatus`, `AttachmentType`, `SessionState`, `User`, `Project`, `Task`, `TimeLog`, `Attachment`, `Session`
  - Include Telegram types: `TelegramUpdate`, `TelegramMessage`, `TelegramCallbackQuery`, `TelegramUser`, `TelegramChat`, `TelegramDocument`, `TelegramPhotoSize`
  - Include service types: `HandlerContext`, `TimeSpent`, `TaskActivity`, `ProjectSummary`
  - Include session context interfaces: `AwaitingTaskNameContext`, `AwaitingDeliverableContext`
  - Include domain error classes: `ActiveTaskExistsError`, `NoActiveTaskError`, `NoPausedTaskError`, `DuplicateProjectError`, `FileTooLargeError`, `UnauthorizedError`, `ValidationError`, `DatabaseError`, `TelegramApiError`, `StorageError`
  - _Requirements: 1.4, 3.3, 4.3, 5.3, 6.6, 12.1_

- [x] 4. Utility modules
  - [x] 4.1 Write `src/lib/utils/time.ts` — time calculation utilities
    - Implement `calculateTotalTime(timeLogs: TimeLog[]): TimeSpent` — sums `(paused_at OR ended_at) - started_at` across all intervals
    - Implement `formatTimeSpent(time: TimeSpent): string` — returns `"ГГ год ХХ хв"` format
    - Implement `formatDateTime(date: Date | string): string` — returns `"ДД.ММ.РРРР ГГ:ХХ"` format (UTC+2)
    - Implement `getStartOfDay(tz?: string): Date` and `getStartOfWeek(tz?: string): Date` for UTC+2 boundaries
    - _Requirements: 6.6, 8.2, 8.3, 8.5, 9.4_

  - [ ]* 4.2 Write property test for time calculation (Property 5)
    - **Property 5: Time Calculation Is Correct for Any Log Sequence**
    - Generate arbitrary arrays of `{started_at, paused_at?, ended_at?}` intervals where end >= start
    - Assert total equals sum of individual interval durations; no interval counted twice
    - Tag: `// Feature: telegram-time-tracker, Property 5: Time calculation is correct for any log sequence`
    - **Validates: Requirements 6.6**
    - _File: `src/lib/utils/time.test.ts`_

  - [x] 4.3 Write `src/lib/utils/validation.ts`
    - Implement `validateTaskName(name: string): boolean` — 1–200 characters
    - Implement `validateRole(role: string): role is UserRole` — accepts only `'admin'` or `'employee'`
    - _Requirements: 1.4, 3.3, 16.4_

  - [ ]* 4.4 Write property test for role validation (Property 1)
    - **Property 1: Role Validation Rejects Invalid Values**
    - Generate arbitrary strings; assert `validateRole` returns true iff value is exactly `'admin'` or `'employee'`
    - Tag: `// Feature: telegram-time-tracker, Property 1: Role validation rejects invalid values`
    - **Validates: Requirements 1.4**
    - _File: `src/lib/utils/validation.test.ts`_

  - [x] 4.5 Write `src/lib/utils/logger.ts`
    - Implement `logger.info`, `logger.error`, `logger.warn` wrappers over `console` with ISO timestamp prefix
    - _Requirements: 11.4, 13.5, 16.1_

- [x] 5. Ukrainian message constants
  - Write `src/lib/messages.ts` exporting a `MESSAGES` object with all user-facing Ukrainian strings
  - Include keys for: `NOT_REGISTERED`, `NO_PERMISSION`, `WELCOME`, `MAIN_MENU_EMPLOYEE`, `MAIN_MENU_ADMIN`, `NO_ACTIVE_PROJECTS`, `TASK_STARTED`, `TASK_PAUSED`, `TASK_RESUMED`, `TASK_COMPLETED`, `NO_ACTIVE_TASK`, `NO_PAUSED_TASK`, `ACTIVE_TASK_EXISTS`, `DUPLICATE_PROJECT`, `PROJECT_CREATED`, `PROJECT_DEACTIVATED`, `ATTACH_DELIVERABLE_PROMPT`, `DELIVERABLE_SAVED`, `FILE_TOO_LARGE`, `TASK_NAME_TOO_LONG`, `NO_ACTIVITY`, `DB_ERROR`, `TELEGRAM_API_ERROR`, `STORAGE_ERROR`, `SESSION_RESET`
  - _Requirements: 1.2, 3.5, 4.4, 5.4, 6.4, 7.4, 16.1–16.5_

- [x] 6. Telegram client wrapper
  - [x] 6.1 Write `src/lib/telegram/types.ts`
    - Define `InlineKeyboard`, `InlineKeyboardButton`, `InlineKeyboardMarkup` types
    - _Requirements: 3.1, 6.3_

  - [x] 6.2 Write `src/lib/telegram/client.ts` — Telegram Bot API wrapper
    - Implement `sendMessage(chatId, text, options?)` with optional `reply_markup` and `parse_mode`
    - Implement `editMessageReplyMarkup(chatId, messageId, replyMarkup)`
    - Implement `answerCallbackQuery(callbackQueryId, text?)`
    - Implement `getFile(fileId)` — returns `file_path` from Telegram
    - Implement `downloadFile(filePath)` — downloads file bytes from Telegram CDN
    - Apply one-retry logic (1 s delay) for non-notification API errors per Requirement 16.2
    - Read `TELEGRAM_BOT_TOKEN` from `process.env`
    - _Requirements: 13.2, 16.2_

  - [x] 6.3 Write `src/lib/telegram/keyboards.ts` — inline keyboard builders
    - Export static keyboards: `EMPLOYEE_MAIN_MENU`, `ADMIN_MAIN_MENU`, `ACTIVITY_PERIOD_KEYBOARD`, `DELIVERABLE_CHOICE_KEYBOARD`, `ADD_MORE_KEYBOARD`
    - Implement `buildProjectKeyboard(projects: Project[]): InlineKeyboardMarkup`
    - Implement `buildEmployeeListKeyboard(employees: User[]): InlineKeyboardMarkup`
    - Implement `buildTaskListKeyboard(tasks: Task[]): InlineKeyboardMarkup`
    - Implement `buildPaginationKeyboard(page, totalPages, prefix): InlineKeyboardMarkup`
    - Implement `buildFilterKeyboard(): InlineKeyboardMarkup` for task/log filter options
    - _Requirements: 3.1, 8.1, 9.1, 10.1, 10.5_

- [x] 7. SessionService
  - Write `src/lib/services/session.service.ts` implementing the `SessionService` interface
  - `getSession(userId)` — upserts a session row and returns it
  - `setState(userId, state, context?)` — updates `state`, `context`, and `updated_at = NOW()`
  - `resetSession(userId)` — sets `state = null`, `context = null`
  - `isExpired(session)` — returns true if `updated_at` is older than 24 hours
  - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [ ]* 7.1 Write property test for session persistence (Property 8)
    - **Property 8: Session State Persistence Round Trip**
    - Generate arbitrary `SessionState` values and `context` objects; save then load; assert identity
    - Assert expired sessions (> 24 h) are detected by `isExpired`
    - Tag: `// Feature: telegram-time-tracker, Property 8: Session state persistence round trip`
    - **Validates: Requirements 12.1, 12.2**
    - _File: `src/lib/services/session.service.test.ts`_

- [x] 8. UserService
  - Write `src/lib/services/user.service.ts` implementing the `UserService` interface
  - `findByTelegramId(telegramId)` — queries `users` by `telegram_id`; returns `null` if not found
  - `createUser(telegramId, role, firstName?, username?)` — validates role with `validateRole`, inserts row
  - `getAllEmployeesWithWeeklyTime()` — joins `users`, `tasks`, `time_logs` to compute weekly minutes per employee
  - `getDisplayName(user)` — returns `first_name` or `@username` or `telegram_id.toString()`
  - _Requirements: 1.1, 1.3, 1.4, 9.1_

  - [ ]* 8.1 Write property test for role validation in UserService (Property 1 — service layer)
    - **Property 1: Role Validation Rejects Invalid Values (service layer)**
    - Attempt `createUser` with arbitrary non-role strings; assert `ValidationError` is thrown
    - Tag: `// Feature: telegram-time-tracker, Property 1: Role validation rejects invalid values`
    - **Validates: Requirements 1.4**
    - _File: `src/lib/services/user.service.test.ts`_

- [x] 9. ProjectService
  - Write `src/lib/services/project.service.ts` implementing the `ProjectService` interface
  - `getActiveProjects()` — queries `projects WHERE is_active = true`
  - `getAllProjects()` — queries all projects
  - `createProject(name)` — inserts project with `is_active = true`; throws `DuplicateProjectError` on unique constraint violation
  - `deactivateProject(projectId)` — sets `is_active = false`
  - `findById(projectId)` — returns project or `null`
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 9.1 Write property test for project creation (Property 2)
    - **Property 2: Project Creation Sets Active Status**
    - Generate random valid project names; assert created record has `is_active = true` and exact name
    - Tag: `// Feature: telegram-time-tracker, Property 2: Project creation sets active status`
    - **Validates: Requirements 2.1**
    - _File: `src/lib/services/project.service.test.ts`_

  - [ ]* 9.2 Write property test for active project filter (Property 3)
    - **Property 3: Active Project Filter Excludes Inactive Projects**
    - Generate mixed collections of active/inactive projects; assert `getActiveProjects` returns exactly the active subset
    - Tag: `// Feature: telegram-time-tracker, Property 3: Active project filter excludes inactive projects`
    - **Validates: Requirements 2.4, 3.1**
    - _File: `src/lib/services/project.service.test.ts`_

- [x] 10. TaskService and time calculation integration
  - Write `src/lib/services/task.service.ts` implementing the `TaskService` interface
  - `startTask(userId, projectId, taskName)` — validates task name length; checks no existing `in_progress` task (throws `ActiveTaskExistsError`); inserts `tasks` row with `status = 'in_progress'` and `time_logs` row with `started_at = NOW()`
  - `pauseTask(userId)` — finds `in_progress` task (throws `NoActiveTaskError` if none); updates latest `time_logs` row with `paused_at = NOW()`; sets task `status = 'paused'`
  - `resumeTask(userId)` — finds `paused` task (throws `NoPausedTaskError` if none); inserts new `time_logs` row with `started_at = NOW()`; sets task `status = 'in_progress'`
  - `completeTask(userId)` — finds `in_progress` or `paused` task; sets `ended_at = NOW()` on latest open log; sets task `status = 'completed'`; returns `totalTime` via `calculateTotalTime`
  - `getActiveTask(userId)` — returns task with `status IN ('in_progress', 'paused')` or `null`
  - `getTasksForUser(userId, from, to)` — returns `TaskActivity[]` with joined project name and computed time
  - `getTasksWithFilters(filters, page)` — paginated query with optional `projectId`/`userId` filters (10 per page)
  - `getTimeLogs(taskId)` — returns all `time_logs` for a task
  - `calculateTotalTime(timeLogs)` — delegates to `time.ts` utility
  - _Requirements: 3.3, 3.4, 4.3, 5.3, 6.4, 6.6, 8.2, 8.3, 10.4, 10.5_

  - [ ]* 10.1 Write property test for task creation state (Property 4)
    - **Property 4: Task Creation Produces Consistent State**
    - Generate random valid task names (1–200 chars), project IDs, user IDs; assert created task has `status = 'in_progress'` and time_log has `started_at` set
    - Tag: `// Feature: telegram-time-tracker, Property 4: Task creation produces consistent state`
    - **Validates: Requirements 3.3**
    - _File: `src/lib/services/task.service.test.ts`_

  - [ ]* 10.2 Write property test for pause-resume round trip (Property 6)
    - **Property 6: Pause-Resume Round Trip Preserves Task Identity**
    - For any `in_progress` task, pause then resume; assert `id`, `name`, `project_id`, `user_id` unchanged and an additional `time_logs` record exists
    - Tag: `// Feature: telegram-time-tracker, Property 6: Pause-resume round trip preserves task identity`
    - **Validates: Requirements 4.3, 5.3**
    - _File: `src/lib/services/task.service.test.ts`_

- [x] 11. StorageService
  - Write `src/lib/services/storage.service.ts` implementing the `StorageService` interface
  - `uploadFile(fileId, fileName, fileSize)` — throws `FileTooLargeError` if `fileSize > 20 * 1024 * 1024`; calls `telegramClient.getFile` then `downloadFile`; uploads bytes to Supabase Storage at path `{userId}/{taskId}/{timestamp}-{fileName}`; returns public/signed URL
  - `saveTextAttachment(taskId, text)` — inserts `attachments` row with `type = 'text'`
  - `saveFileAttachment(taskId, url, fileName)` — inserts `attachments` row with `type = 'file'`
  - `getAttachments(taskId)` — queries `attachments WHERE task_id = ?`
  - Read `SUPABASE_STORAGE_BUCKET` from `process.env`
  - _Requirements: 7.1, 7.2, 7.3, 7.6_

  - [ ]* 11.1 Write property test for attachment round trip (Property 7)
    - **Property 7: Attachment Storage Round Trip**
    - Generate arbitrary file URLs and text content; save then retrieve by `task_id`; assert exact content returned
    - Tag: `// Feature: telegram-time-tracker, Property 7: Attachment storage round trip`
    - **Validates: Requirements 7.2, 7.3**
    - _File: `src/lib/services/storage.service.test.ts`_

- [x] 12. NotificationService
  - Write `src/lib/services/notification.service.ts` implementing the `NotificationService` interface
  - `notifyTaskStarted(employee, task, project, startedAt)` — fetches all `admin` users; sends formatted Ukrainian message to each via `telegramClient.sendMessage`; catches and logs `TelegramApiError` per admin without rethrowing
  - `notifyTaskCompleted(employee, task, project, totalTime, attachments)` — same fan-out pattern; includes attachment list in message if non-empty
  - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 13. Checkpoint — core services complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Employee handlers
  - Write `src/lib/handlers/employee.handlers.ts`
  - `handleStartTask(ctx)` — checks no active task; sends project selection keyboard (shows error if no active projects)
  - `handleProjectSelected(ctx, projectId)` — validates project exists; sets session state `awaiting_task_name` with `selectedProjectId` and `selectedProjectName`; prompts for task name
  - `handleTaskNameInput(ctx, text)` — validates length (1–200 chars); calls `taskService.startTask`; sends confirmation with task name, project, start time; calls `notificationService.notifyTaskStarted`; resets session to `idle`
  - `handlePauseTask(ctx)` — calls `taskService.pauseTask`; sends confirmation with task name and pause time; resets session
  - `handleResumeTask(ctx)` — calls `taskService.resumeTask`; sends confirmation with task name and resume time; resets session
  - `handleCompleteTask(ctx)` — checks active/paused task exists; sends `DELIVERABLE_CHOICE_KEYBOARD`; sets session state `awaiting_deliverable_choice`
  - `handleDeliverableChoice(ctx, choice)` — if `'yes'`: sets state `awaiting_deliverable`; if `'skip'`: calls `taskService.completeTask`, sends confirmation with total time, calls `notificationService.notifyTaskCompleted`, resets session
  - `handleDeliverableInput(ctx, message)` — accepts file or text; calls `storageService.uploadFile` or `storageService.saveTextAttachment`; sends confirmation; sets state `awaiting_deliverable_choice`
  - `handleAddMoreOrFinish(ctx, choice)` — if `'add_more'`: sets state `awaiting_deliverable`; if `'finish'`: finalises task, sends confirmation, notifies admins, resets session
  - `handleMyActivity(ctx)` — sends `ACTIVITY_PERIOD_KEYBOARD`
  - `handleActivityPeriod(ctx, period)` — queries tasks for today or this week (UTC+2); formats and sends Markdown report; handles empty case
  - _Requirements: 3.1–3.5, 4.1–4.4, 5.1–5.4, 6.1–6.6, 7.1–7.6, 8.1–8.5, 16.3, 16.4_

- [x] 15. Admin handlers
  - Write `src/lib/handlers/admin.handlers.ts`
  - `handleCreateProject(ctx)` — sets session state `awaiting_project_name`; prompts for project name
  - `handleProjectNameInput(ctx, text)` — calls `projectService.createProject`; sends success or duplicate error message; resets session
  - `handleDeactivateProject(ctx)` — fetches active projects; sends project selection keyboard
  - `handleDeactivateProjectConfirm(ctx, projectId)` — calls `projectService.deactivateProject`; sends confirmation; resets session
  - `handleEmployees(ctx)` — calls `userService.getAllEmployeesWithWeeklyTime`; sends formatted list with weekly hours per employee
  - `handleEmployeeDetail(ctx, userId)` — fetches tasks for employee for current week; sends detailed report with task name, project, status, time spent
  - `handleTasksLogs(ctx)` — sends filter keyboard
  - `handleTasksFilter(ctx, filter)` — routes to all-tasks, by-project, or by-employee sub-flows
  - `handleTaskDetail(ctx, taskId)` — fetches `time_logs` and `attachments` for task; sends full detail message
  - `handlePagination(ctx, prefix, page)` — re-fetches paginated data and updates message
  - _Requirements: 2.1–2.4, 9.1–9.4, 10.1–10.5_

- [x] 16. Router (state machine)
  - Write `src/lib/handlers/router.ts`
  - Implement `route(update: TelegramUpdate, ctx: HandlerContext): Promise<void>`
  - Parse `callback_data` prefix (`action:`, `project:`, `period:`, `deliverable:`, `employee:`, `task:`, `filter:`, `page:`) and dispatch to the correct handler
  - Dispatch text messages based on session state (`awaiting_project_name`, `awaiting_task_name`, `awaiting_deliverable`)
  - Enforce role-based access: employee actions rejected for admins; admin actions rejected for employees — send `MESSAGES.NO_PERMISSION` and return without DB mutation
  - Handle `/start` command: show role-appropriate main menu
  - Handle unknown commands/messages in `idle` state: show main menu
  - _Requirements: 1.5, 12.2, 15.2, 15.3_

  - [ ]* 16.1 Write property test for role-based access control (Property 9)
    - **Property 9: Role-Based Access Control Rejects Unauthorized Actions**
    - For all admin-only `callback_data` values × employee users: assert `NO_PERMISSION` response, no DB mutation
    - For all employee-only `callback_data` values × admin users: assert same
    - Tag: `// Feature: telegram-time-tracker, Property 9: Role-based access control rejects unauthorized actions`
    - **Validates: Requirements 15.2, 15.3**
    - _File: `src/lib/handlers/router.test.ts`_

- [x] 17. Webhook handler (Next.js API route)
  - Write `src/app/api/telegram/webhook/route.ts`
  - Implement `POST(request: Request): Promise<Response>`
  - Validate `X-Telegram-Bot-Api-Secret-Token` header against `process.env.TELEGRAM_WEBHOOK_SECRET`; return HTTP 401 if mismatch
  - Parse JSON body; return HTTP 200 with logged error on invalid JSON
  - Respond HTTP 200 immediately; call `processUpdate(update).catch(logger.error)` asynchronously
  - Implement `processUpdate`: extract `telegramId`/`chatId`; load user; handle unregistered users; load and check session expiry; handle `/cancel`; call `router.route`
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 16.5_

  - [ ]* 17.1 Write property test for webhook authentication (Property 10)
    - **Property 10: Webhook Authentication Rejects Invalid Tokens**
    - Generate arbitrary strings as `X-Telegram-Bot-Api-Secret-Token`; assert HTTP 401 returned and `processUpdate` never called when token does not match configured secret
    - Tag: `// Feature: telegram-time-tracker, Property 10: Webhook authentication rejects invalid tokens`
    - **Validates: Requirements 13.4**
    - _File: `src/app/api/telegram/webhook/route.test.ts`_

- [ ] 18. Unit / example-based tests
  - [ ]* 18.1 Write unit tests for `/start` command with registered and unregistered users
    - Registered user → role-appropriate main menu sent; unregistered user → `MESSAGES.NOT_REGISTERED` sent, no DB mutation
    - _Requirements: 1.1, 1.2, 16.5_

  - [ ]* 18.2 Write unit tests for task name validation boundaries
    - Length 0 → rejected; length 1 → accepted; length 200 → accepted; length 201 → rejected with `MESSAGES.TASK_NAME_TOO_LONG`
    - _Requirements: 3.3, 16.4_

  - [ ]* 18.3 Write unit tests for duplicate project name rejection
    - Second `createProject` with same name → `DuplicateProjectError` thrown and user notified
    - _Requirements: 2.2_

  - [ ]* 18.4 Write unit tests for pagination boundaries
    - 10 items → no pagination buttons; 11 items → "Вперед" button shown; 20 items → both navigation buttons on page 1
    - _Requirements: 10.5_

  - [ ]* 18.5 Write unit tests for `/cancel` command
    - `/cancel` from any session state → session reset to `idle`, main menu shown
    - _Requirements: 12.4_

  - [ ]* 18.6 Write unit tests for session expiry
    - Session `updated_at` = 23h 59m ago → not expired; session `updated_at` = 24h 1m ago → expired, reset to idle
    - _Requirements: 12.3_

  - [ ]* 18.7 Write unit tests for notification failure isolation
    - `telegramClient.sendMessage` throws for one admin → error logged, task completion still succeeds, other admins still notified
    - _Requirements: 11.4_

  - [ ]* 18.8 Write unit tests for webhook with invalid JSON
    - POST with non-JSON body → HTTP 200 returned, error logged
    - _Requirements: 13.5_

  - [ ]* 18.9 Write unit tests for no active projects scenario
    - `getActiveProjects` returns empty array → `MESSAGES.NO_ACTIVE_PROJECTS` sent to employee
    - _Requirements: 16.3_

- [x] 19. Checkpoint — all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 20. Environment variable validation and deployment configuration
  - Add `src/lib/utils/env.ts` that reads and validates all required environment variables at startup; throws a descriptive error if any are missing
  - Create `vercel.json` with region configuration (e.g., `fra1`) and function timeout settings
  - Add `README.md` with deployment checklist: create Supabase project, apply `schema.sql`, create `task-attachments` storage bucket, deploy to Vercel with env vars, register Telegram webhook via `setWebhook` API call, verify with `getWebhookInfo`
  - _Requirements: 15.1, 13.1_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Checkpoints at tasks 13 and 19 ensure incremental validation
- Property tests (Properties 1–10) validate universal correctness properties using `fast-check` with minimum 100 iterations each
- Unit tests validate specific examples and boundary conditions
- All user-facing text must be in Ukrainian; use `MESSAGES` constants exclusively — never inline strings
