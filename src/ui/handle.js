const HANDLE_DRAG_THRESHOLD_PX = 6;
export const HANDLE_EDGES = Object.freeze(['right', 'left', 'top', 'bottom']);

export function clampHandleFraction(fraction) {
    const numeric = Number(fraction);
    return Math.min(0.92, Math.max(0.08, Number.isFinite(numeric) ? numeric : 0.5));
}

export function parseStoredHandlePosition(raw) {
    if (raw === null || raw === undefined || raw === '') return null;

    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
        return { edge: 'right', fraction: clampHandleFraction(numeric) };
    }

    try {
        const parsed = JSON.parse(String(raw));
        if (HANDLE_EDGES.includes(parsed?.edge)) {
            return { edge: parsed.edge, fraction: clampHandleFraction(parsed.fraction) };
        }
    } catch {
        return null;
    }

    return null;
}

export function resolveHandleDock(centerX, centerY, viewportWidth, viewportHeight) {
    const distances = {
        left: centerX,
        right: viewportWidth - centerX,
        top: centerY,
        bottom: viewportHeight - centerY,
    };
    const edge = HANDLE_EDGES.reduce((best, candidate) => (distances[candidate] < distances[best] ? candidate : best), 'right');
    const fraction = edge === 'left' || edge === 'right'
        ? centerY / (viewportHeight || 1)
        : centerX / (viewportWidth || 1);

    return { edge, fraction: clampHandleFraction(fraction) };
}

export function bindDockableHandle(handleElement, { loadPosition, savePosition, onClick }) {
    if (!handleElement?.addEventListener) return () => {};

    let suppressClickUntil = 0;
    let activePointerId = null;
    let startClientX = 0;
    let startClientY = 0;
    let startCenterX = 0;
    let startCenterY = 0;
    let dragging = false;

    const viewportWidth = () => globalThis.visualViewport?.width || globalThis.innerWidth || 1;
    const viewportHeight = () => globalThis.visualViewport?.height || globalThis.innerHeight || 1;

    const place = () => {
        const { edge, fraction } = loadPosition() ?? { edge: 'right', fraction: 0.5 };
        handleElement.dataset.edge = edge;
        const rect = handleElement.getBoundingClientRect();
        const width = rect.width || 36;
        const height = rect.height || 92;
        const vw = viewportWidth();
        const vh = viewportHeight();
        let left = edge === 'left' ? 0 : vw - width;
        let top = clampHandleFraction(fraction) * vh - height / 2;
        if (edge === 'top' || edge === 'bottom') {
            top = edge === 'top' ? 0 : vh - height;
            left = clampHandleFraction(fraction) * vw - width / 2;
        }

        handleElement.style.left = `${Math.round(Math.min(Math.max(left, 0), vw - width))}px`;
        handleElement.style.top = `${Math.round(Math.min(Math.max(top, 0), vh - height))}px`;
    };

    const requestPlace = () => globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(place) : place();
    requestPlace();

    const begin = (clientX, clientY) => {
        startClientX = clientX;
        startClientY = clientY;
        const rect = handleElement.getBoundingClientRect();
        startCenterX = rect.left + rect.width / 2;
        startCenterY = rect.top + rect.height / 2;
        dragging = false;
    };

    const move = (clientX, clientY) => {
        const deltaX = clientX - startClientX;
        const deltaY = clientY - startClientY;
        if (!dragging && Math.max(Math.abs(deltaX), Math.abs(deltaY)) < HANDLE_DRAG_THRESHOLD_PX) return;
        dragging = true;
        const rect = handleElement.getBoundingClientRect();
        handleElement.style.left = `${Math.round(startCenterX + deltaX - rect.width / 2)}px`;
        handleElement.style.top = `${Math.round(startCenterY + deltaY - rect.height / 2)}px`;
    };

    const finish = cancelled => {
        const wasDragging = dragging;
        dragging = false;
        activePointerId = null;
        if (!wasDragging) return;
        suppressClickUntil = Date.now() + 350;
        if (!cancelled) {
            const rect = handleElement.getBoundingClientRect();
            const dock = resolveHandleDock(rect.left + rect.width / 2, rect.top + rect.height / 2, viewportWidth(), viewportHeight());
            savePosition(dock);
        }
        requestPlace();
    };

    const onPointerDown = event => {
        if (event.pointerType === 'touch') return;
        activePointerId = event.pointerId;
        handleElement.setPointerCapture?.(activePointerId);
        begin(event.clientX, event.clientY);
    };
    const onPointerMove = event => {
        if (activePointerId !== event.pointerId) return;
        move(event.clientX, event.clientY);
    };
    const onPointerUp = event => {
        if (activePointerId !== event.pointerId) return;
        finish(false);
    };
    const onPointerCancel = event => {
        if (activePointerId !== event.pointerId) return;
        finish(true);
    };
    const onTouchStart = event => {
        const touch = event.changedTouches?.[0];
        if (!touch) return;
        begin(touch.clientX, touch.clientY);
    };
    const onTouchMove = event => {
        const touch = event.changedTouches?.[0];
        if (!touch) return;
        move(touch.clientX, touch.clientY);
        if (dragging) event.preventDefault();
    };
    const onTouchEnd = () => finish(false);
    const onTouchCancel = () => finish(true);
    const onHandleClick = event => {
        if (Date.now() < suppressClickUntil) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        onClick?.();
    };

    handleElement.addEventListener('pointerdown', onPointerDown);
    handleElement.addEventListener('pointermove', onPointerMove);
    handleElement.addEventListener('pointerup', onPointerUp);
    handleElement.addEventListener('pointercancel', onPointerCancel);
    handleElement.addEventListener('touchstart', onTouchStart, { passive: true });
    handleElement.addEventListener('touchmove', onTouchMove, { passive: false });
    handleElement.addEventListener('touchend', onTouchEnd);
    handleElement.addEventListener('touchcancel', onTouchCancel);
    handleElement.addEventListener('click', onHandleClick);
    globalThis.addEventListener?.('resize', requestPlace);
    globalThis.visualViewport?.addEventListener?.('resize', requestPlace);

    return () => {
        handleElement.removeEventListener('pointerdown', onPointerDown);
        handleElement.removeEventListener('pointermove', onPointerMove);
        handleElement.removeEventListener('pointerup', onPointerUp);
        handleElement.removeEventListener('pointercancel', onPointerCancel);
        handleElement.removeEventListener('touchstart', onTouchStart);
        handleElement.removeEventListener('touchmove', onTouchMove);
        handleElement.removeEventListener('touchend', onTouchEnd);
        handleElement.removeEventListener('touchcancel', onTouchCancel);
        handleElement.removeEventListener('click', onHandleClick);
        globalThis.removeEventListener?.('resize', requestPlace);
        globalThis.visualViewport?.removeEventListener?.('resize', requestPlace);
    };
}
