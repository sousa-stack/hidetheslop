SLOP_API.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return false;
  if (msg.type === 'inspect') {
    SlopVision.inspect(msg.url).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg.type === 'hash') {
    SlopVision.hash(msg.url).then(sendResponse, () => sendResponse(null));
    return true;
  }
  return false;
});
