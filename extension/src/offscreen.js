SLOP_API.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return false;
  if (msg.type === 'embed') {
    SlopVision.embed(msg.url).then(sendResponse, () => sendResponse(null));
    return true;
  }
  return false;
});
