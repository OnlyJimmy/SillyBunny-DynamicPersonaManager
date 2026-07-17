import test from 'node:test';
import assert from 'node:assert/strict';
import { clampHandleFraction, parseStoredHandlePosition, resolveHandleDock } from '../src/ui/handle.js';

test('handle fraction clamps to reachable safe range', () => {
    assert.equal(clampHandleFraction(-1), 0.08);
    assert.equal(clampHandleFraction(2), 0.92);
    assert.equal(clampHandleFraction(Number.NaN), 0.5);
});

test('handle parser accepts legacy numeric value', () => {
    assert.deepEqual(parseStoredHandlePosition('0.25'), { edge: 'right', fraction: 0.25 });
});

test('handle parser accepts docked JSON value', () => {
    assert.deepEqual(parseStoredHandlePosition('{"edge":"left","fraction":0.75}'), { edge: 'left', fraction: 0.75 });
});

test('handle dock resolves nearest viewport edge', () => {
    assert.deepEqual(resolveHandleDock(5, 50, 100, 100), { edge: 'left', fraction: 0.5 });
    assert.deepEqual(resolveHandleDock(95, 50, 100, 100), { edge: 'right', fraction: 0.5 });
    assert.deepEqual(resolveHandleDock(50, 4, 100, 100), { edge: 'top', fraction: 0.5 });
    assert.deepEqual(resolveHandleDock(50, 96, 100, 100), { edge: 'bottom', fraction: 0.5 });
});
