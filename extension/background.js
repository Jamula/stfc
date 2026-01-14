chrome.runtime.onInstalled.addListener(() => {
  console.log('STFC Gift Redeemer extension installed');
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.includes('startrekfleetcommand.com')) {
    chrome.action.openPopup();
  } else {
    chrome.tabs.create({ url: 'https://home.startrekfleetcommand.com/store' });
  }
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.url.includes('startrekfleetcommand.com')) {
    chrome.tabs.sendMessage(details.tabId, { type: 'PAGE_LOADED' });
  }
});

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.cookie.domain.includes('startrekfleetcommand.com')) {
    chrome.storage.local.set({
      lastAuthCheck: Date.now(),
      authStatus: changeInfo.removed ? 'unauthenticated' : 'authenticated'
    });
  }
});
