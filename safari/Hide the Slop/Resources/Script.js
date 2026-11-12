// ViewController.swift calls show() once it knows whether the extension is on.
function show(enabled) {
    document.body.classList.toggle('state-on', enabled === true);
    document.body.classList.toggle('state-off', enabled === false);
}

document.querySelector('button.open-preferences').addEventListener('click', () => {
    webkit.messageHandlers.controller.postMessage('open-preferences');
});
