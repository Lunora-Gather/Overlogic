// RuntimeDiagnostics.js — bounded, privacy-safe diagnostics for support and QA.
//
// This module intentionally keeps everything in memory. It never writes
// telemetry to localStorage and never sends data over the network. The support
// bundle can include the bounded snapshot when a player explicitly downloads
// it, which gives maintainers useful release/error/frame information without
// silently collecting gameplay or device identifiers.

const MAX_ERRORS = 20;
const MAX_EVENTS = 30;
const LONG_FRAME_MS = 50;

const startedAt = new Date().toISOString();
let bootDurationMs = null;
let frameCount = 0;
let totalFrameMs = 0;
let longFrameCount = 0;
let lastFrameMs = 0;
let errors = [];
let events = [];

function boundedText(value, max = 240) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .slice(0, max);
}

function now() {
  return new Date().toISOString();
}

export function recordRuntimeError(error, context = 'runtime') {
  const source = error?.error || error?.reason || error;
  const message = boundedText(source?.message || source, 240) || 'Unknown runtime error';
  const name = boundedText(source?.name || 'Error', 64);
  errors = [{ at: now(), context: boundedText(context, 48), name, message }, ...errors].slice(0, MAX_ERRORS);
}

export function recordStorageError(error, store = 'unknown') {
  recordRuntimeError(error, `storage:${store}`);
}

export function recordRuntimeEvent(name) {
  const eventName = boundedText(name, 64);
  if (!eventName) return;
  events = [{ at: now(), name: eventName }, ...events].slice(0, MAX_EVENTS);
}

export function recordFrame(frameMs) {
  const value = Number(frameMs);
  if (!Number.isFinite(value) || value < 0 || value > 10_000) return;
  frameCount += 1;
  totalFrameMs += value;
  lastFrameMs = value;
  if (value >= LONG_FRAME_MS) longFrameCount += 1;
}

export function markBootComplete(durationMs) {
  const value = Number(durationMs);
  if (Number.isFinite(value) && value >= 0 && value <= 120_000) bootDurationMs = Math.round(value);
}

export function runtimeDiagnosticsSnapshot({ maxErrors = MAX_ERRORS, maxEvents = MAX_EVENTS } = {}) {
  const errorLimit = Number.isSafeInteger(maxErrors)
    ? Math.max(0, Math.min(MAX_ERRORS, maxErrors)) : MAX_ERRORS;
  const eventLimit = Number.isSafeInteger(maxEvents)
    ? Math.max(0, Math.min(MAX_EVENTS, maxEvents)) : MAX_EVENTS;
  return {
    version: 1,
    release: boundedText(globalThis.__OVERLOGIC_RELEASE__ || 'dev', 48),
    startedAt,
    bootDurationMs,
    frames: {
      count: frameCount,
      averageMs: frameCount > 0 ? Number((totalFrameMs / frameCount).toFixed(2)) : null,
      lastMs: frameCount > 0 ? Number(lastFrameMs.toFixed(2)) : null,
      longFrameCount,
    },
    errors: errors.slice(0, errorLimit).map((entry) => ({ ...entry })),
    events: events.slice(0, eventLimit).map((entry) => ({ ...entry })),
  };
}

export function resetRuntimeDiagnostics() {
  bootDurationMs = null;
  frameCount = 0;
  totalFrameMs = 0;
  longFrameCount = 0;
  lastFrameMs = 0;
  errors = [];
  events = [];
}
