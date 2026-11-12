// ViewController.swift calls show() once it knows whether the extension is on, and again
// whenever you come back to the app.
function show(enabled) {
    document.body.classList.toggle('state-on', enabled === true);
    document.body.classList.toggle('state-off', enabled === false);
}

// The same report as Email a report in the extension's Settings: only the version and
// browser, and nothing goes anywhere until you send it from your own email app.
function setVersion(version) {
    const report = `What went wrong:\n\n\nWhich site, if it's about one (just the site, like facebook.com):\n\n\n---\nHide the Slop ${version}, Safari`;
    document.querySelector('a.report').href = `mailto:hello@hidetheslop.com?subject=${encodeURIComponent('Hide the Slop: a problem')}&body=${encodeURIComponent(report)}`;
}

// The window stays open after the button, so it says what happened.
function settingsOpened(ok) {
    const note = document.querySelector('.opened');
    note.textContent = ok
        ? 'Safari’s settings are open. Tick Hide the Slop there, then come back.'
        : 'Safari didn’t open its settings. Open Safari, then choose Safari → Settings → Extensions.';
    note.hidden = false;
}

document.querySelector('button.open-preferences').addEventListener('click', () => {
    webkit.messageHandlers.controller.postMessage('open-preferences');
});
