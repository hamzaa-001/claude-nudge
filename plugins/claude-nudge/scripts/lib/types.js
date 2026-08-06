// types.js — JSDoc typedefs shared across modules (no runtime code).

/**
 * @typedef {Object} NudgeEvent
 * @property {'turn_start'|'turn_end'|'needs_input'|'session_end'} kind
 * @property {string}  sessionId
 * @property {string}  cwd
 * @property {string}  project        basename(cwd), or "unknown"
 * @property {string=} message        raw text from Notification events only
 * @property {number}  at             epoch ms
 * @property {string}  rawEventName   original hook_event_name, for logging
 */

/**
 * @typedef {Object} Decision
 * @property {boolean} notify
 * @property {string}  reason         e.g. 'below_min_duration', 'quiet_hours', 'ok'
 * @property {'low'|'normal'|'high'} priority
 */

/**
 * @typedef {Object} Notification
 * @property {string}  title
 * @property {string}  body
 * @property {'low'|'normal'|'high'} priority
 * @property {string[]} tags
 * @property {string}  project
 * @property {number}  durationMs
 * @property {number}  at
 */

export {};
