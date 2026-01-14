import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Code, Copy, CheckCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';

export function ScriptGenerator() {
  const [copied, setCopied] = useState(false);

  const automationScript = `
(async function() {
  console.log('🚀 STFC Gift Redeemer - Starting...');
  
  const selectors = [
    'button:not([disabled])',
    '[class*="gift"]',
    '[class*="free"]',
    '[class*="claim"]',
    '[class*="redeem"]',
    '[data-testid*="gift"]',
    '[data-testid*="claim"]',
    'a[href*="gift"]',
    'div[role="button"]',
  ];

  const allButtons = [];
  
  for (const selector of selectors) {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => {
        const text = el.textContent?.toLowerCase() || '';
        const className = el.className?.toLowerCase() || '';
        const id = el.id?.toLowerCase() || '';
        
        if (
          (text.includes('gift') || 
           text.includes('free') || 
           text.includes('claim') || 
           text.includes('redeem')) &&
          !text.includes('buy') &&
          !text.includes('purchase') &&
          !allButtons.includes(el)
        ) {
          allButtons.push(el);
        } else if (
          className.includes('gift') || 
          className.includes('free') || 
          className.includes('claim') ||
          id.includes('gift') ||
          id.includes('claim')
        ) {
          if (!allButtons.includes(el)) {
            allButtons.push(el);
          }
        }
      });
    } catch (e) {
      console.warn(\`Selector \${selector} failed:\`, e);
    }
  }

  const giftButtons = allButtons.filter((btn) => {
    const rect = btn.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  if (giftButtons.length === 0) {
    console.error('❌ No gift buttons found!');
    alert('No gift buttons found. Make sure you are logged in.');
    return;
  }

  console.log(\`✅ Found \${giftButtons.length} potential gifts\`);

  for (let i = 0; i < giftButtons.length; i++) {
    const button = giftButtons[i];
    
    try {
      button.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 500));
      
      button.click();
      console.log(\`🎁 Clicked gift \${i + 1}/\${giftButtons.length}\`);
      
      await new Promise(r => setTimeout(r, 1200));
      
      const confirmButtons = document.querySelectorAll('button, [role="button"], a');
      
      for (const confirmBtn of Array.from(confirmButtons)) {
        const text = confirmBtn.textContent?.toLowerCase() || '';
        if (
          text.includes('confirm') ||
          text.includes('accept') ||
          text.includes('claim') ||
          text.includes('yes')
        ) {
          confirmBtn.click();
          console.log('✓ Clicked confirmation');
          await new Promise(r => setTimeout(r, 800));
          break;
        }
      }
    } catch (btnError) {
      console.warn(\`Failed to click button \${i + 1}:\`, btnError);
    }
  }

  console.log('🎉 All gifts processed!');
  alert(\`Finished! Attempted to claim \${giftButtons.length} gifts.\`);
})();
`.trim();

  const copyScript = () => {
    navigator.clipboard.writeText(automationScript);
    setCopied(true);
    toast.success('Script Copied!', {
      description: 'Paste it in the browser console on the STFC store page',
    });
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <Card className="backdrop-blur-xl bg-card/90 border-2 border-primary/30 shadow-[0_4px_20px_rgba(100,181,246,0.2)]">
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary/20 p-2 rounded-lg border-2 border-primary/50">
            <Code weight="fill" className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Manual Script</h2>
            <p className="text-sm text-muted-foreground">
              Use this if iframe automation fails
            </p>
          </div>
        </div>

        <Alert className="border-2 border-accent/30 bg-accent/5">
          <AlertDescription className="text-sm space-y-2">
            <p className="font-semibold text-foreground">Instructions:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Open the STFC store in a new tab</li>
              <li>Log in to your account</li>
              <li>Press F12 to open Developer Tools</li>
              <li>Go to the "Console" tab</li>
              <li>Copy and paste the script below</li>
              <li>Press Enter to run it</li>
            </ol>
          </AlertDescription>
        </Alert>

        <div className="relative">
          <pre className="bg-secondary/50 border-2 border-primary/20 rounded-lg p-4 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto">
            <code className="text-foreground">{automationScript}</code>
          </pre>
          <Button
            onClick={copyScript}
            size="sm"
            className="absolute top-2 right-2 bg-primary/90 hover:bg-primary text-primary-foreground"
          >
            {copied ? (
              <>
                <CheckCircle weight="fill" className="w-4 h-4 mr-1" />
                Copied!
              </>
            ) : (
              <>
                <Copy weight="bold" className="w-4 h-4 mr-1" />
                Copy Script
              </>
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}
