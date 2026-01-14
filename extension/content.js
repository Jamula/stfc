let isAuthenticated = false;

const checkAuthStatus = () => {
  const loginButtons = document.querySelectorAll('[href*="login"], button[class*="login"], a[class*="signin"]');
  const userElements = document.querySelectorAll('[class*="user"], [class*="profile"], [class*="avatar"]');
  
  const wasAuthenticated = isAuthenticated;
  isAuthenticated = userElements.length > 0 && loginButtons.length === 0;
  
  if (wasAuthenticated !== isAuthenticated) {
    chrome.runtime.sendMessage({
      type: 'AUTH_STATUS_CHANGE',
      authenticated: isAuthenticated
    });
  }
  
  return isAuthenticated;
};

const observer = new MutationObserver(() => {
  checkAuthStatus();
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_LOADED') {
    checkAuthStatus();
  }
});

checkAuthStatus();
