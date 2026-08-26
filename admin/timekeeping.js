(() => {
  'use strict';

  const SUPABASE_URL = 'https://tjqnmyjttqukowcehzmq.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_tkWA-7LTA9R5wKw7_vi_ng_YDYnS1M0';
  const IDLE_RESET_MS = 40000;
  const SUCCESS_RESET_MS = 3800;
  const STAFF_REFRESH_AFTER_HIDDEN_MS = 60000;

  const VIEW = Object.freeze({
    LOADING: 'loading',
    SELECT: 'select',
    PIN: 'pin',
    CHECKING: 'checking',
    CONFIRM: 'confirm',
    SUBMITTING: 'submitting',
    SUCCESS: 'success',
    ERROR: 'error',
    STAFF_ERROR: 'staff-error',
  });

  const ACTION = Object.freeze({
    CLOCK_IN: 'clock-in',
    CLOCK_OUT: 'clock-out',
    BREAK_START: 'break-start',
    BREAK_END: 'break-end',
  });

  const stage = document.querySelector('[data-kiosk-stage]');
  const content = document.querySelector('[data-kiosk-content]');
  const liveRegion = document.querySelector('[data-kiosk-live]');

  let client = null;
  let requestGeneration = 0;
  let idleTimer = null;
  let successTimer = null;
  let displayTimer = null;
  let hiddenAt = 0;

  const state = {
    view: VIEW.LOADING,
    staff: [],
    selectedStaff: null,
    pin: '',
    actionPin: '',
    staffStatus: null,
    actionType: '',
    actionResult: null,
    pinError: '',
    error: null,
    selectionNotice: '',
    staffBusy: false,
    statusBusy: false,
    actionBusy: false,
  };

  function makeElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function makeButton(label, className, onClick, attributes = {}) {
    const button = makeElement('button', className, label);
    button.type = 'button';
    Object.entries(attributes).forEach(([name, value]) => {
      if (value === false || value === null || value === undefined) return;
      if (value === true) button.setAttribute(name, '');
      else button.setAttribute(name, String(value));
    });
    button.addEventListener('click', onClick);
    return button;
  }

  function appendIntro(view, eyebrow, heading, copy) {
    if (eyebrow) view.appendChild(makeElement('p', 'kiosk-eyebrow', eyebrow));
    const title = makeElement('h1', 'kiosk-heading', heading);
    title.tabIndex = -1;
    title.dataset.viewHeading = '';
    view.appendChild(title);
    if (copy) view.appendChild(makeElement('p', 'kiosk-copy', copy));
  }

  function announce(message = '') {
    if (!liveRegion) return;
    liveRegion.textContent = '';
    if (message) {
      window.setTimeout(() => {
        if (liveRegion) liveRegion.textContent = message;
      }, 20);
    }
  }

  function getSupabaseClient() {
    if (client) return client;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;

    client = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );
    return client;
  }

  function getSafeTechnicalError(error) {
    return {
      code: error && typeof error.code === 'string' ? error.code : '',
      message: error && typeof error.message === 'string' ? error.message : 'Unknown request failure',
    };
  }

  function logTechnicalError(context, error) {
    console.error(`[CURV timekeeping] ${context}`, getSafeTechnicalError(error));
  }

  function parseRpcResponse(data, error, { expectList = false } = {}) {
    if (error) return { kind: 'transport', error };

    if (expectList) {
      if (!Array.isArray(data)) return { kind: 'malformed' };
      const safeStaff = [];
      for (const item of data) {
        const id = item && typeof item.id === 'string' ? item.id.trim() : '';
        const name = item && typeof item.name === 'string' ? item.name.trim() : '';
        if (!id || !name) return { kind: 'malformed' };
        safeStaff.push({ id, name });
      }
      return { kind: 'success', value: safeStaff };
    }

    const value = Array.isArray(data) && data.length === 1 ? data[0] : data;
    if (!value || typeof value !== 'object') return { kind: 'malformed' };
    if (value.ok === true) return { kind: 'success', value };
    if (value.ok === false && typeof value.error_code === 'string') {
      return {
        kind: 'business',
        errorCode: value.error_code,
        message: typeof value.message === 'string' ? value.message : '',
      };
    }
    return { kind: 'malformed' };
  }

  function clearTimer(timerName) {
    if (timerName === 'idle' && idleTimer !== null) {
      window.clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (timerName === 'success' && successTimer !== null) {
      window.clearTimeout(successTimer);
      successTimer = null;
    }
    if (timerName === 'display' && displayTimer !== null) {
      window.clearInterval(displayTimer);
      displayTimer = null;
    }
  }

  function clearAllTimers() {
    clearTimer('idle');
    clearTimer('success');
    clearTimer('display');
  }

  function clearSensitiveState({ clearSelection = true } = {}) {
    state.pin = '';
    state.actionPin = '';
    state.staffStatus = null;
    state.actionType = '';
    state.actionResult = null;
    state.pinError = '';
    state.error = null;
    state.statusBusy = false;
    state.actionBusy = false;
    if (clearSelection) state.selectedStaff = null;
  }

  function invalidateRequests() {
    requestGeneration += 1;
  }

  function isSensitiveView() {
    return [VIEW.PIN, VIEW.CHECKING, VIEW.CONFIRM, VIEW.ERROR].includes(state.view);
  }

  function armIdleReset() {
    clearTimer('idle');
    if (!isSensitiveView() || state.actionBusy) return;
    idleTimer = window.setTimeout(() => {
      resetToStaffSelection('For privacy, the kiosk returned to the team list.');
    }, IDLE_RESET_MS);
  }

  function handleActivity() {
    if (isSensitiveView() && !state.actionBusy) armIdleReset();
  }

  function formatKioskClock() {
    const now = new Date();
    const weekday = new Intl.DateTimeFormat('en-PH', { weekday: 'long' }).format(now);
    const time = new Intl.DateTimeFormat('en-PH', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(now);
    return `${weekday} \u00b7 ${time}`;
  }

  function parseTimestamp(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
  }

  function formatServerTime(value) {
    const date = parseTimestamp(value);
    if (!date) return 'Time unavailable';
    return new Intl.DateTimeFormat('en-PH', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  }

  function formatDurationSeconds(value) {
    const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
    if (totalSeconds < 60) return 'Less than a minute';
    const totalMinutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!hours) return `${totalMinutes} min`;
    if (!minutes) return `${hours} hr`;
    return `${hours} hr ${minutes} min`;
  }

  function formatElapsedFrom(value) {
    const startedAt = parseTimestamp(value);
    if (!startedAt) return '';
    return formatDurationSeconds((Date.now() - startedAt.getTime()) / 1000);
  }

  function focusCurrentView() {
    window.requestAnimationFrame(() => {
      const target = state.view === VIEW.PIN
        ? content.querySelector('[data-pin-key="1"]')
        : content.querySelector('[data-primary-focus], [data-view-heading]');
      if (target && typeof target.focus === 'function') target.focus();
    });
  }

  function updateDisplayText() {
    const clock = content.querySelector('[data-kiosk-clock]');
    if (clock) clock.textContent = formatKioskClock();

    const shiftDuration = content.querySelector('[data-live-shift-duration]');
    if (shiftDuration && state.staffStatus) {
      const elapsed = formatElapsedFrom(state.staffStatus.clocked_in_at);
      shiftDuration.textContent = elapsed ? `On shift for ${elapsed}` : '';
    }

    const breakDuration = content.querySelector('[data-live-break-duration]');
    if (breakDuration && state.staffStatus) {
      const elapsed = formatElapsedFrom(state.staffStatus.break_started_at);
      breakDuration.textContent = elapsed ? `Break time: ${elapsed}` : '';
    }
  }

  function syncDisplayTimer() {
    clearTimer('display');
    updateDisplayText();
    if (state.view === VIEW.SELECT || state.view === VIEW.CONFIRM) {
      displayTimer = window.setInterval(updateDisplayText, 60000);
    }
  }

  function renderLoading() {
    const view = makeElement('div', 'kiosk-view');
    appendIntro(view, 'CURV Team', 'Clock In / Out', 'Loading team\u2026');
    const busy = makeElement('div', 'busy-mark');
    busy.setAttribute('aria-hidden', 'true');
    view.appendChild(busy);
    return view;
  }

  function selectStaff(staff) {
    if (!staff || state.staffBusy) return;
    invalidateRequests();
    clearSensitiveState({ clearSelection: false });
    state.selectedStaff = { id: staff.id, name: staff.name };
    state.selectionNotice = '';
    state.view = VIEW.PIN;
    render({ announceMessage: `Selected ${staff.name}. Enter your 4-digit PIN.` });
  }

  function renderStaffSelection() {
    const view = makeElement('div', 'kiosk-view');
    appendIntro(view, 'CURV Team', 'Clock In / Out', 'Choose your name to continue.');

    const clock = makeElement('p', 'kiosk-clock', formatKioskClock());
    clock.dataset.kioskClock = '';
    view.appendChild(clock);

    if (state.selectionNotice) {
      view.appendChild(makeElement('p', 'kiosk-feedback', state.selectionNotice));
    }

    if (!state.staff.length) {
      view.appendChild(makeElement('p', 'kiosk-empty', 'No active staff are available yet.'));
    } else {
      const grid = makeElement('div', 'staff-grid');
      grid.setAttribute('aria-label', 'Active staff');
      state.staff.forEach((staff, index) => {
        grid.appendChild(makeButton(
          staff.name,
          'staff-button',
          () => selectStaff(staff),
          index === 0 ? { 'data-primary-focus': true } : {}
        ));
      });
      view.appendChild(grid);
    }

    const refresh = makeButton('Refresh team', 'text-button staff-refresh', () => loadStaff());
    if (!state.staff.length) refresh.dataset.primaryFocus = '';
    view.appendChild(refresh);
    return view;
  }

  function updatePinIndicator(view) {
    const indicator = view.querySelector('[data-pin-indicator]');
    if (!indicator) return;
    indicator.setAttribute('aria-label', `${state.pin.length} of 4 digits entered`);
    indicator.querySelectorAll('.pin-dot').forEach((dot, index) => {
      dot.classList.toggle('is-filled', index < state.pin.length);
    });
  }

  function appendPinDigit(digit) {
    if (state.view !== VIEW.PIN || state.statusBusy || state.pin.length >= 4) return;
    state.pin += digit;
    updatePinIndicator(content);
    armIdleReset();
    if (state.pin.length === 4) window.setTimeout(() => checkStaffStatus(), 80);
  }

  function removePinDigit() {
    if (state.view !== VIEW.PIN || state.statusBusy || !state.pin.length) return;
    state.pin = state.pin.slice(0, -1);
    state.pinError = '';
    render();
  }

  function clearPinDigits() {
    if (state.view !== VIEW.PIN || state.statusBusy) return;
    state.pin = '';
    state.pinError = '';
    render();
  }

  function renderPinEntry() {
    const view = makeElement('div', 'kiosk-view');
    appendIntro(view, 'Staff PIN', 'Enter your 4-digit PIN', 'Your PIN stays on this device only for this check.');
    view.appendChild(makeElement('p', 'kiosk-person', state.selectedStaff ? state.selectedStaff.name : ''));

    const indicator = makeElement('div', 'pin-indicator');
    indicator.dataset.pinIndicator = '';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.setAttribute('aria-label', `${state.pin.length} of 4 digits entered`);
    for (let index = 0; index < 4; index += 1) {
      const dot = makeElement('span', `pin-dot${index < state.pin.length ? ' is-filled' : ''}`);
      dot.setAttribute('aria-hidden', 'true');
      indicator.appendChild(dot);
    }
    view.appendChild(indicator);

    if (state.pinError) view.appendChild(makeElement('p', 'kiosk-feedback', state.pinError));

    const pad = makeElement('div', 'pin-pad');
    pad.setAttribute('aria-label', 'PIN keypad');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach(digit => {
      const button = makeButton(digit, 'pin-key', () => appendPinDigit(digit), {
        'aria-label': `Digit ${digit}`,
        'data-pin-key': digit,
      });
      pad.appendChild(button);
    });
    pad.appendChild(makeButton('\u2190', 'pin-key is-utility', removePinDigit, { 'aria-label': 'Delete last digit' }));
    pad.appendChild(makeButton('0', 'pin-key', () => appendPinDigit('0'), {
      'aria-label': 'Digit 0',
      'data-pin-key': '0',
    }));
    pad.appendChild(makeButton('Clear', 'pin-key is-utility', clearPinDigits, { 'aria-label': 'Clear PIN' }));
    view.appendChild(pad);

    const actions = makeElement('div', 'kiosk-actions');
    actions.appendChild(makeButton('Back to team', 'text-button', () => resetToStaffSelection()));
    view.appendChild(actions);
    return view;
  }

  function renderBusy(heading, copy) {
    const view = makeElement('div', 'kiosk-view');
    appendIntro(view, 'Please wait', heading, copy);
    const busy = makeElement('div', 'busy-mark');
    busy.setAttribute('aria-hidden', 'true');
    view.appendChild(busy);
    return view;
  }

  function cancelConfirmation() {
    resetToStaffSelection();
  }

  function renderConfirmation() {
    const status = state.staffStatus || {};
    const isClockedIn = status.is_clocked_in === true;
    const isOnBreak = isClockedIn && status.is_on_break === true;
    const staffName = state.selectedStaff ? state.selectedStaff.name : 'Team member';
    const view = makeElement('div', 'kiosk-view');

    if (!isClockedIn) {
      appendIntro(view, 'Start Shift', staffName, 'Ready to start your shift?');
    } else if (isOnBreak) {
      appendIntro(view, 'On Break', "You're on break", staffName);
    } else {
      appendIntro(view, 'On Shift', staffName, 'Your shift is currently active.');
    }

    if (isClockedIn) {
      const panel = makeElement('div', 'confirmation-panel');

      if (isOnBreak) {
        panel.appendChild(makeElement('p', 'kiosk-time', `Started at ${formatServerTime(status.break_started_at)}`));
        const breakDuration = makeElement('p', 'kiosk-duration kiosk-duration-primary');
        breakDuration.dataset.liveBreakDuration = '';
        panel.appendChild(breakDuration);
        panel.appendChild(makeElement('p', 'kiosk-shift-start', `Shift started: ${formatServerTime(status.clocked_in_at)}`));
      } else {
        panel.appendChild(makeElement('p', 'kiosk-time', `Clocked in at ${formatServerTime(status.clocked_in_at)}`));
        const shiftDuration = makeElement('p', 'kiosk-duration');
        shiftDuration.dataset.liveShiftDuration = '';
        panel.appendChild(shiftDuration);
      }

      view.appendChild(panel);
    }

    const actions = makeElement('div', `kiosk-actions${isClockedIn && !isOnBreak ? ' is-working-actions' : ''}`);

    if (!isClockedIn) {
      actions.appendChild(makeButton(
        'Clock In',
        'primary-button',
        () => submitTimekeepingAction(ACTION.CLOCK_IN),
        { 'aria-label': `Clock in ${staffName}`, 'data-primary-focus': true }
      ));
    } else if (isOnBreak) {
      actions.appendChild(makeButton(
        'End Break',
        'primary-button is-break-end',
        () => submitTimekeepingAction(ACTION.BREAK_END),
        { 'aria-label': `End break for ${staffName}`, 'data-primary-focus': true }
      ));
    } else {
      actions.appendChild(makeButton(
        'Start Break',
        'primary-button is-break-start',
        () => submitTimekeepingAction(ACTION.BREAK_START),
        { 'aria-label': `Start break for ${staffName}`, 'data-primary-focus': true }
      ));
      actions.appendChild(makeButton(
        'Clock Out',
        'secondary-button is-clock-out',
        () => submitTimekeepingAction(ACTION.CLOCK_OUT),
        { 'aria-label': `Clock out ${staffName}` }
      ));
    }

    actions.appendChild(makeButton('Back to team', 'text-button action-back', cancelConfirmation));
    view.appendChild(actions);
    return view;
  }

  function renderSuccess() {
    const result = state.actionResult || {};
    const staffName = state.selectedStaff ? state.selectedStaff.name : 'Team member';
    const successContent = {
      [ACTION.CLOCK_IN]: {
        heading: "You're clocked in",
        timestamp: result.clocked_in_at,
        note: `Good shift, ${staffName}!`,
      },
      [ACTION.CLOCK_OUT]: {
        heading: "You're clocked out",
        timestamp: result.clocked_out_at,
        note: `Nice work today, ${staffName}!`,
      },
      [ACTION.BREAK_START]: {
        heading: 'Break started',
        timestamp: result.started_at,
        note: `Enjoy your break, ${staffName}.`,
      },
      [ACTION.BREAK_END]: {
        heading: 'Break ended',
        timestamp: result.ended_at,
        note: `Back to it, ${staffName}.`,
      },
    }[state.actionType] || {};
    const view = makeElement('div', 'kiosk-view');
    const mark = makeElement('div', 'success-mark', '\u2713');
    mark.setAttribute('aria-hidden', 'true');
    view.appendChild(mark);
    appendIntro(view, 'Recorded', successContent.heading || 'Attendance recorded', '');
    view.appendChild(makeElement('p', 'kiosk-time', formatServerTime(successContent.timestamp)));

    if (state.actionType === ACTION.BREAK_END && Number.isFinite(Number(result.duration_seconds))) {
      view.appendChild(makeElement('p', 'kiosk-duration', `Break time: ${formatDurationSeconds(result.duration_seconds)}`));
    }
    if (successContent.note) view.appendChild(makeElement('p', 'kiosk-success-note', successContent.note));

    const actions = makeElement('div', 'kiosk-actions');
    actions.appendChild(makeButton('Done', 'primary-button', () => resetToStaffSelection(), { 'data-primary-focus': true }));
    view.appendChild(actions);
    return view;
  }

  function handleErrorAction(action) {
    if (action === 'refresh-staff') {
      loadStaff();
      return;
    }
    if (action === 'pin-again' && state.selectedStaff) {
      invalidateRequests();
      state.pin = '';
      state.actionPin = '';
      state.staffStatus = null;
      state.error = null;
      state.view = VIEW.PIN;
      render();
      return;
    }
    resetToStaffSelection();
  }

  function renderError() {
    const error = state.error || {};
    const view = makeElement('div', 'kiosk-view');
    appendIntro(view, error.eyebrow || 'Try Again', error.title || 'Something went wrong', error.message || 'Please return to the team list.');
    const actions = makeElement('div', 'kiosk-actions');
    actions.appendChild(makeButton(
      error.primaryLabel || 'Back to team',
      'primary-button',
      () => handleErrorAction(error.primaryAction || 'back-team'),
      { 'data-primary-focus': true }
    ));
    if (error.secondaryLabel) {
      actions.appendChild(makeButton(
        error.secondaryLabel,
        'secondary-button',
        () => handleErrorAction(error.secondaryAction || 'back-team')
      ));
    }
    view.appendChild(actions);
    return view;
  }

  function renderStaffError() {
    const view = makeElement('div', 'kiosk-view');
    appendIntro(view, 'Connection', 'Timekeeping is temporarily unavailable.', 'Check the connection, then try loading the team again.');
    const actions = makeElement('div', 'kiosk-actions');
    actions.appendChild(makeButton('Try Again', 'primary-button', () => loadStaff(), { 'data-primary-focus': true }));
    view.appendChild(actions);
    return view;
  }

  function render({ announceMessage = '', focus = true } = {}) {
    if (!stage || !content) return;
    clearTimer('display');
    clearTimer('idle');

    let view;
    if (state.view === VIEW.LOADING) view = renderLoading();
    else if (state.view === VIEW.SELECT) view = renderStaffSelection();
    else if (state.view === VIEW.PIN) view = renderPinEntry();
    else if (state.view === VIEW.CHECKING) view = renderBusy('Checking your status', 'Confirming your PIN securely.');
    else if (state.view === VIEW.CONFIRM) view = renderConfirmation();
    else if (state.view === VIEW.SUBMITTING) {
      const busyHeading = {
        [ACTION.CLOCK_IN]: 'Clocking you in',
        [ACTION.CLOCK_OUT]: 'Clocking you out',
        [ACTION.BREAK_START]: 'Starting your break',
        [ACTION.BREAK_END]: 'Ending your break',
      }[state.actionType] || 'Recording attendance';
      view = renderBusy(busyHeading, 'Please keep this page open until the result is confirmed.');
    }
    else if (state.view === VIEW.SUCCESS) view = renderSuccess();
    else if (state.view === VIEW.STAFF_ERROR) view = renderStaffError();
    else view = renderError();

    content.replaceChildren(view);
    stage.dataset.state = state.view;
    stage.setAttribute('aria-busy', String([VIEW.LOADING, VIEW.CHECKING, VIEW.SUBMITTING].includes(state.view)));
    syncDisplayTimer();
    armIdleReset();
    announce(announceMessage);
    if (focus) focusCurrentView();
  }

  function showError(error, announceMessage = '') {
    state.pin = '';
    state.actionPin = '';
    state.staffStatus = null;
    state.statusBusy = false;
    state.actionBusy = false;
    state.error = error;
    state.view = VIEW.ERROR;
    render({ announceMessage: announceMessage || error.message });
  }

  function resetToStaffSelection(message = '') {
    invalidateRequests();
    clearAllTimers();
    clearSensitiveState();
    state.staffBusy = false;
    state.selectionNotice = message;
    state.view = VIEW.SELECT;
    render({ announceMessage: message });
  }

  async function loadStaff() {
    if (state.staffBusy || state.actionBusy) return;
    invalidateRequests();
    const generation = requestGeneration;
    clearAllTimers();
    clearSensitiveState();
    state.selectionNotice = '';
    state.staffBusy = true;
    state.view = VIEW.LOADING;
    render({ announceMessage: 'Loading team.' });

    const kioskClient = getSupabaseClient();
    if (!kioskClient) {
      if (generation !== requestGeneration) return;
      state.staffBusy = false;
      state.view = VIEW.STAFF_ERROR;
      render({ announceMessage: 'Timekeeping is temporarily unavailable.' });
      return;
    }

    try {
      const { data, error } = await kioskClient.rpc('timekeeping_list_active_staff');
      if (generation !== requestGeneration) return;
      const parsed = parseRpcResponse(data, error, { expectList: true });
      state.staffBusy = false;

      if (parsed.kind === 'success') {
        state.staff = parsed.value;
        state.view = VIEW.SELECT;
        render({ announceMessage: state.staff.length ? 'Team loaded.' : 'No active staff are available yet.' });
        return;
      }

      if (parsed.kind === 'transport') logTechnicalError('Staff list request failed.', parsed.error);
      else logTechnicalError('Staff list response was malformed.', null);
      state.view = VIEW.STAFF_ERROR;
      render({ announceMessage: 'Timekeeping is temporarily unavailable.' });
    } catch (error) {
      if (generation !== requestGeneration) return;
      state.staffBusy = false;
      logTechnicalError('Staff list request threw an exception.', error);
      state.view = VIEW.STAFF_ERROR;
      render({ announceMessage: 'Timekeeping is temporarily unavailable.' });
    }
  }

  function handleStatusBusinessError(parsed) {
    if (parsed.errorCode === 'TIMEKEEPING_INVALID_CREDENTIALS') {
      state.pin = '';
      state.actionPin = '';
      state.pinError = 'Incorrect PIN. Try again.';
      state.view = VIEW.PIN;
      render({ announceMessage: state.pinError });
      return;
    }

    if (parsed.errorCode === 'TIMEKEEPING_PIN_LOCKED') {
      showError({
        eyebrow: 'PIN Locked',
        title: 'Please wait before trying again.',
        message: parsed.message || 'Too many incorrect attempts. Please wait a few minutes before trying again.',
        primaryLabel: 'Back to team',
        primaryAction: 'back-team',
      });
      return;
    }

    if (parsed.errorCode === 'TIMEKEEPING_STAFF_UNAVAILABLE') {
      showError({
        eyebrow: 'Team Update',
        title: 'This staff profile is currently unavailable.',
        message: 'Refresh the team list before trying again.',
        primaryLabel: 'Refresh team',
        primaryAction: 'refresh-staff',
      });
      return;
    }

    showError({
      eyebrow: 'Status Unavailable',
      title: "We couldn't check your status.",
      message: 'Enter your PIN again or return to the team list.',
      primaryLabel: 'Enter PIN again',
      primaryAction: 'pin-again',
      secondaryLabel: 'Back to team',
      secondaryAction: 'back-team',
    });
  }

  async function checkStaffStatus() {
    if (state.view !== VIEW.PIN || state.statusBusy || state.pin.length !== 4 || !state.selectedStaff) return;
    invalidateRequests();
    const generation = requestGeneration;
    let submittedPin = state.pin;
    state.statusBusy = true;
    state.pinError = '';
    state.view = VIEW.CHECKING;
    render({ announceMessage: 'Checking your status.' });

    const kioskClient = getSupabaseClient();
    if (!kioskClient) {
      submittedPin = '';
      if (generation !== requestGeneration) return;
      showError({
        eyebrow: 'Connection',
        title: "We couldn't check your status.",
        message: 'Check the connection, then enter your PIN again.',
        primaryLabel: 'Enter PIN again',
        primaryAction: 'pin-again',
        secondaryLabel: 'Back to team',
        secondaryAction: 'back-team',
      });
      return;
    }

    try {
      const { data, error } = await kioskClient.rpc('timekeeping_get_staff_status', {
        p_staff_id: state.selectedStaff.id,
        p_pin: submittedPin,
      });
      if (generation !== requestGeneration) {
        submittedPin = '';
        return;
      }

      const parsed = parseRpcResponse(data, error);
      state.pin = '';
      state.statusBusy = false;

      const hasValidStatus = parsed.kind === 'success'
        && typeof parsed.value.is_clocked_in === 'boolean'
        && typeof parsed.value.is_on_break === 'boolean'
        && (!parsed.value.is_clocked_in || Boolean(parseTimestamp(parsed.value.clocked_in_at)))
        && (!parsed.value.is_on_break || Boolean(parseTimestamp(parsed.value.break_started_at)));

      if (hasValidStatus) {
        state.actionPin = submittedPin;
        submittedPin = '';
        state.staffStatus = parsed.value;
        state.actionType = parsed.value.is_clocked_in
          ? (parsed.value.is_on_break === true ? ACTION.BREAK_END : '')
          : ACTION.CLOCK_IN;
        state.view = VIEW.CONFIRM;
        const statusMessage = parsed.value.is_on_break === true
          ? 'You are currently on break.'
          : (parsed.value.is_clocked_in ? 'You are currently clocked in.' : 'You are currently clocked out.');
        render({ announceMessage: statusMessage });
        return;
      }

      submittedPin = '';
      if (parsed.kind === 'business') {
        handleStatusBusinessError(parsed);
        return;
      }

      if (parsed.kind === 'transport') logTechnicalError('Status request failed.', parsed.error);
      else logTechnicalError('Status response was malformed.', null);
      showError({
        eyebrow: 'Connection',
        title: "We couldn't check your status.",
        message: 'Check the connection, then enter your PIN again.',
        primaryLabel: 'Enter PIN again',
        primaryAction: 'pin-again',
        secondaryLabel: 'Back to team',
        secondaryAction: 'back-team',
      });
    } catch (error) {
      submittedPin = '';
      if (generation !== requestGeneration) return;
      state.pin = '';
      state.statusBusy = false;
      logTechnicalError('Status request threw an exception.', error);
      showError({
        eyebrow: 'Connection',
        title: "We couldn't check your status.",
        message: 'Check the connection, then enter your PIN again.',
        primaryLabel: 'Enter PIN again',
        primaryAction: 'pin-again',
        secondaryLabel: 'Back to team',
        secondaryAction: 'back-team',
      });
    }
  }

  function handleActionBusinessError(parsed) {
    if (parsed.errorCode === 'TIMEKEEPING_ALREADY_CLOCKED_IN') {
      showError({
        eyebrow: 'Status Updated',
        title: "It looks like you're already clocked in.",
        message: 'Your attendance status may have changed since it was checked.',
        primaryLabel: 'Done',
        primaryAction: 'back-team',
      });
      return;
    }

    if (parsed.errorCode === 'TIMEKEEPING_NOT_CLOCKED_IN') {
      showError({
        eyebrow: 'Status Updated',
        title: "It looks like you're not currently clocked in.",
        message: 'Your attendance status may have changed since it was checked.',
        primaryLabel: 'Done',
        primaryAction: 'back-team',
      });
      return;
    }

    if (parsed.errorCode === 'TIMEKEEPING_ALREADY_ON_BREAK') {
      showError({
        eyebrow: 'Status Updated',
        title: 'It looks like your break has already started.',
        message: 'Your attendance status may have changed since it was checked.',
        primaryLabel: 'Done',
        primaryAction: 'back-team',
      });
      return;
    }

    if (parsed.errorCode === 'TIMEKEEPING_NOT_ON_BREAK') {
      showError({
        eyebrow: 'Status Updated',
        title: 'It looks like your break has already ended.',
        message: 'Your attendance status may have changed since it was checked.',
        primaryLabel: 'Done',
        primaryAction: 'back-team',
      });
      return;
    }

    if (parsed.errorCode === 'TIMEKEEPING_BREAK_ACTIVE') {
      showError({
        eyebrow: 'Break Active',
        title: 'End your break before clocking out.',
        message: 'Enter your PIN again to check your current status.',
        primaryLabel: 'Done',
        primaryAction: 'back-team',
      });
      return;
    }

    if (parsed.errorCode === 'TIMEKEEPING_STAFF_UNAVAILABLE') {
      showError({
        eyebrow: 'Team Update',
        title: 'This staff profile is currently unavailable.',
        message: 'Refresh the team list before trying again.',
        primaryLabel: 'Refresh team',
        primaryAction: 'refresh-staff',
      });
      return;
    }

    if (parsed.errorCode === 'TIMEKEEPING_PIN_LOCKED') {
      showError({
        eyebrow: 'PIN Locked',
        title: 'Please wait before trying again.',
        message: parsed.message || 'Too many incorrect attempts. Please wait a few minutes before trying again.',
        primaryLabel: 'Back to team',
        primaryAction: 'back-team',
      });
      return;
    }

    showError({
      eyebrow: 'Not Confirmed',
      title: "We couldn't complete that action.",
      message: 'Check your status with your PIN before trying again.',
      primaryLabel: 'Check status',
      primaryAction: 'pin-again',
      secondaryLabel: 'Back to team',
      secondaryAction: 'back-team',
    });
  }

  function showAmbiguousActionFailure() {
    showError({
      eyebrow: 'Result Not Confirmed',
      title: "We couldn't confirm the result.",
      message: 'Please enter your PIN again to check your current status. The action was not retried.',
      primaryLabel: 'Check status',
      primaryAction: 'pin-again',
      secondaryLabel: 'Back to team',
      secondaryAction: 'back-team',
    });
  }

  async function submitTimekeepingAction(actionType = state.actionType) {
    if (state.view !== VIEW.CONFIRM || state.actionBusy || !state.selectedStaff) return;
    const rpcNames = {
      [ACTION.CLOCK_IN]: 'timekeeping_clock_in',
      [ACTION.CLOCK_OUT]: 'timekeeping_clock_out',
      [ACTION.BREAK_START]: 'timekeeping_start_break',
      [ACTION.BREAK_END]: 'timekeeping_end_break',
    };
    const rpcName = rpcNames[actionType];
    if (!rpcName) return;
    if (!/^[0-9]{4}$/.test(state.actionPin)) {
      showError({
        eyebrow: 'PIN Expired',
        title: 'Enter your PIN again.',
        message: 'For privacy, the previous PIN is no longer available.',
        primaryLabel: 'Enter PIN again',
        primaryAction: 'pin-again',
        secondaryLabel: 'Back to team',
        secondaryAction: 'back-team',
      });
      return;
    }

    invalidateRequests();
    const generation = requestGeneration;
    state.actionType = actionType;
    let submittedPin = state.actionPin;
    state.actionPin = '';
    state.actionBusy = true;
    state.view = VIEW.SUBMITTING;
    clearTimer('idle');
    const actionAnnouncement = {
      [ACTION.CLOCK_IN]: 'Clocking you in.',
      [ACTION.CLOCK_OUT]: 'Clocking you out.',
      [ACTION.BREAK_START]: 'Starting your break.',
      [ACTION.BREAK_END]: 'Ending your break.',
    }[state.actionType];
    render({ announceMessage: actionAnnouncement });

    const kioskClient = getSupabaseClient();
    if (!kioskClient) {
      submittedPin = '';
      if (generation !== requestGeneration) return;
      state.actionBusy = false;
      showAmbiguousActionFailure();
      return;
    }

    try {
      const request = kioskClient.rpc(rpcName, {
        p_staff_id: state.selectedStaff.id,
        p_pin: submittedPin,
      });
      submittedPin = '';
      const { data, error } = await request;
      if (generation !== requestGeneration) return;

      const parsed = parseRpcResponse(data, error);
      state.actionBusy = false;

      const hasRequiredResult = parsed.kind === 'success' && {
        [ACTION.CLOCK_IN]: () => Boolean(parseTimestamp(parsed.value.clocked_in_at)),
        [ACTION.CLOCK_OUT]: () => Boolean(parseTimestamp(parsed.value.clocked_out_at)),
        [ACTION.BREAK_START]: () => Boolean(parseTimestamp(parsed.value.started_at)),
        [ACTION.BREAK_END]: () => Boolean(parseTimestamp(parsed.value.ended_at)),
      }[state.actionType]();

      if (hasRequiredResult) {
        state.actionResult = parsed.value;
        state.view = VIEW.SUCCESS;
        const successAnnouncement = {
          [ACTION.CLOCK_IN]: "You're clocked in.",
          [ACTION.CLOCK_OUT]: "You're clocked out.",
          [ACTION.BREAK_START]: 'Break started.',
          [ACTION.BREAK_END]: 'Break ended.',
        }[state.actionType];
        render({ announceMessage: successAnnouncement });
        clearTimer('success');
        successTimer = window.setTimeout(() => resetToStaffSelection(), SUCCESS_RESET_MS);
        return;
      }

      if (parsed.kind === 'business') {
        handleActionBusinessError(parsed);
        return;
      }

      if (parsed.kind === 'transport') logTechnicalError(`${rpcName} request failed.`, parsed.error);
      else logTechnicalError(`${rpcName} response was malformed.`, null);
      showAmbiguousActionFailure();
    } catch (error) {
      submittedPin = '';
      if (generation !== requestGeneration) return;
      state.actionBusy = false;
      logTechnicalError(`${rpcName} request threw an exception.`, error);
      showAmbiguousActionFailure();
    }
  }

  function handleKeyboard(event) {
    handleActivity();
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'Escape') {
      if ([VIEW.PIN, VIEW.CHECKING, VIEW.CONFIRM, VIEW.ERROR].includes(state.view) && !state.actionBusy) {
        event.preventDefault();
        resetToStaffSelection();
      }
      return;
    }

    if (state.view !== VIEW.PIN || state.statusBusy) return;
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      appendPinDigit(event.key);
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      removePinDigit();
      return;
    }
    if (event.key === 'Enter' && state.pin.length === 4) {
      event.preventDefault();
      checkStaffStatus();
    }
  }

  function privacyResetForHiddenPage() {
    const wasSubmitting = state.view === VIEW.SUBMITTING || state.actionBusy;
    hiddenAt = Date.now();
    invalidateRequests();
    clearAllTimers();
    clearSensitiveState();
    state.staffBusy = false;
    state.selectionNotice = wasSubmitting
      ? 'The result was not confirmed before the kiosk was hidden. Check your status before trying again.'
      : '';
    state.view = VIEW.SELECT;
    render({ focus: false });
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      privacyResetForHiddenPage();
      return;
    }

    const hiddenDuration = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    if (!state.staff.length || hiddenDuration >= STAFF_REFRESH_AFTER_HIDDEN_MS) {
      loadStaff();
    } else {
      state.view = VIEW.SELECT;
      render();
    }
  }

  document.addEventListener('keydown', handleKeyboard);
  document.addEventListener('pointerdown', handleActivity, { passive: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', privacyResetForHiddenPage);

  loadStaff();
})();
