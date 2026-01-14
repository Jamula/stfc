# Planning Guide

Automated gift redemption system for Star Trek Fleet Command with both web app and browser extension versions, featuring persistent authentication in the extension.

**Experience Qualities**:
1. **Automated** - One-click redemption of all available gifts with real-time status updates and visual feedback
2. **Reliable** - Robust error handling with clear messaging when authentication or redemption fails; browser extension version provides persistent authentication
3. **Immersive** - Star Trek aesthetic that feels native to the STFC universe with sci-fi inspired design elements

**Complexity Level**: Light Application (multiple features with basic state)
This is a specialized tool with focused functionality—automated gift claiming, history tracking, and dual deployment options (web app + browser extension).

## Essential Features

### Browser Extension with Persistent Authentication
- **Functionality**: Standalone browser extension that maintains user authentication across sessions
- **Purpose**: Solves the web app's iframe authentication limitation by running as a trusted browser component
- **Trigger**: User installs extension, navigates to STFC store, and clicks extension icon
- **Progression**: Install extension → Open STFC store → Log in once → Authentication persists indefinitely → Click extension icon → Redeem gifts
- **Success criteria**: Login session survives page reloads, browser restarts, and extension popup closes; no re-authentication required

### Web App with Embedded Store
- **Functionality**: Web-based interface with embedded STFC store iframe for quick access
- **Purpose**: Provides instant access without installation for occasional users
- **Trigger**: User visits web app URL
- **Progression**: Load app → Iframe loads STFC store → User logs in → Redemption available → Session expires on refresh
- **Success criteria**: Iframe loads correctly, redemption works while session active, clear messaging about session limitations

### Automated Gift Redemption
- **Functionality**: Scans page for claimable gifts and automatically clicks through claim flow
- **Purpose**: Eliminates tedious manual clicking through multiple gift pages and confirmation dialogs
- **Trigger**: User clicks "Redeem All Gifts" button
- **Progression**: User clicks button → Script scans DOM for gift buttons → Each gift clicked → Confirmation dialogs auto-accepted → Progress tracked → History updated
- **Success criteria**: Script successfully scans and clicks gift buttons, handles confirmations, updates progress bar in real-time

### Gift History Tracker
- **Functionality**: Records all claimed gifts with timestamps and descriptions
- **Purpose**: Provides users with a record of rewards claimed over time, helps track daily patterns
- **Trigger**: Automatically triggered when gifts are redeemed
- **Progression**: Gift claimed → Entry created with title, description, timestamp → Stored in KV (web) or Chrome Storage (extension) → Displayed in history tab
- **Success criteria**: All claimed gifts logged accurately, history persists between sessions, clear history option available

### Authentication Status Detection
- **Functionality**: Monitors user's login state and displays current authentication status
- **Purpose**: Informs users when they need to authenticate and explains persistence differences
- **Trigger**: Page load, periodic checks every 30s (web) or 5s (extension)
- **Progression**: Script checks DOM for login/user elements → Status badge updates → Warning shown if unauthenticated → Success message if authenticated
- **Success criteria**: Accurate auth state detection, clear visual indicators, helpful messaging about extension vs web app differences
## Edge Case Handling
- **Authentication Failures in Web App**: Clear error message when iframe blocks authentication; "Open Store" button to access in new tab where login works normally
- **Iframe Session Persistence**: Web app clearly explains that embedded iframe login sessions cannot persist between page reloads due to browser security (same-origin policy); recommends browser extension for persistent auth
- **Extension Not on Store Page**: Extension displays "disconnected" status with "Open STFC Store" button; only enables redemption when user is on correct page
- **No Gifts Available**: Display encouraging message when all gifts have been claimed; shows total claimed count
- **Cross-Origin Restrictions**: Extension uses content scripts and browser APIs to bypass CORS; web app gracefully handles access errors with user-friendly messages
- **Confirmation Dialogs**: Script intelligently searches for confirm/accept/yes buttons and handles multiple confirmation patterns
- **Browser Compatibility**: Extension manifest v3 for Chrome/Edge; provides Firefox-compatible installation instructions; web app works in all modern browsers
## Design Direction
The design should feel like accessing a Starfleet command interface—a tactical HUD that provides mission-critical information with precision and clarity. The extension popup should maintain the same aesthetic in a compact format.
## Color Selection
A bold sci-fi palette combining deep space blacks with vibrant neon accents reminiscent of warp plasma and starship HUDs.
- **Primary Color**: Electric Blue (oklch(0.65 0.18 240)) - Represents dilithium energy and advanced technology, used for primary CTAs

  - Background Deep Navy (okl
  - Accent Warp Green (oklch(0.75 0.20 145)): Deep Space Navy (oklch(0.15 0.02 250)) - Ratio 6.8:1 ✓



- **Secondary**: JetBrains Mono - Monospace for codes, quantities, and technical details

  - H2 (Gift Title): S
  - Caption (Status badges): Space Grotesk Medium/12px/wide tracking (0.05em)





  - Progress: Linear 

  - ScrollArea: Scrollable gift history list and script code
- **Customizations**:
  - Sidebar control panel (fixed width ~384px on desktop, full-screen on mobile)
  - Authentication status detection with periodic checking (every 30s)
  - Progress indicator with animated gradient fill
  - Script generator component with formatted code display and one-click copy
  - History entry cards with timestamp, category badges, and gift details
- **States**:

  - Copy button: De

  - Rocket (app branding)

  - WarningCircle 

A bold sci-fi palette combining deep space blacks with vibrant neon accents reminiscent of warp plasma and starship HUDs.

- **Primary Color**: Electric Blue (oklch(0.65 0.18 240)) - Represents dilithium energy and advanced technology, used for primary CTAs and active states
- **Secondary Colors**: Deep Space Navy (oklch(0.15 0.02 250)) for backgrounds; Starship Gray (oklch(0.25 0.01 250)) for cards and control panels
- **Accent Color**: Warp Plasma Green (oklch(0.75 0.20 145)) - High-energy highlight for success states and automation indicators
- **Foreground/Background Pairings**: 
  - Background Deep Navy (oklch(0.15 0.02 250)): White text (oklch(0.98 0 0)) - Ratio 12.5:1 ✓
  - Card Gray (oklch(0.25 0.01 250)): Light Blue-White (oklch(0.95 0.02 240)) - Ratio 10.2:1 ✓
  - Accent Warp Green (oklch(0.75 0.20 145)): Deep Space Navy (oklch(0.15 0.02 250)) - Ratio 6.8:1 ✓
  - Primary Electric Blue (oklch(0.65 0.18 240)): White text (oklch(1 0 0)) - Ratio 5.2:1 ✓

## Font Selection

Typography should convey futuristic precision with geometric letterforms that feel technical yet readable—inspired by starship interfaces and mission logs.

- **Primary**: Space Grotesk - Geometric sans with technical character, perfect for the sci-fi aesthetic
- **Secondary**: JetBrains Mono - Monospace for codes, quantities, and technical details

- **Typographic Hierarchy**:
  - H1 (App Title): Space Grotesk Bold/32px/tight tracking (-0.02em)
  - H2 (Gift Title): Space Grotesk Semibold/20px/normal tracking
  - Body (Description): Space Grotesk Regular/15px/relaxed leading (1.6)
  - Caption (Status badges): Space Grotesk Medium/12px/wide tracking (0.05em) uppercase
  - Code (Quantities): JetBrains Mono Medium/14px/normal

## Animations

Animations should feel like starship console interactions—crisp, purposeful, and satisfying. Control panel slides in from top with backdrop blur effect on load. Redemption progress shows with animated progress bar and pulsing indicator. Success states trigger brief glow effects. Keep durations snappy (150-250ms) to maintain the feeling of responsive, advanced technology. Loading states use rotating spinner with orbital paths.

## Component Selection

- **Components**:
  - Tabs: Sidebar navigation for History and Script sections with clean tab transitions
  - Button: Primary "Redeem All Gifts" button with loading states; secondary "Open Store" and "Refresh" buttons; "Copy Script" button for manual approach; "Clear History" button for gift history
  - Progress: Linear progress bar for redemption status with percentage display
  - Badge: Status indicators showing connection state, authentication state, and redemption count; category badges in history entries
  - Alert: Error notifications for failed operations; informational alerts about session persistence and cross-origin restrictions
  - Separator: Dividers between history entries
  - ScrollArea: Scrollable gift history list and script code
  
- **Customizations**:
  - Full-screen iframe with persistent login state tracking
  - Sidebar control panel (fixed width ~384px on desktop, full-screen on mobile)
  - Tabbed interface for History and Script sections
  - Session key persistence using useKV for maintaining login state
  - Authentication status detection with periodic checking (every 30s)
  - Progress indicator with animated gradient fill
  - Status badges with connection and auth state
  - Script generator component with formatted code display and one-click copy
  - Gift history tracker with persistent storage and relative timestamps
  - History entry cards with timestamp, category badges, and gift details
  
- **States**:
  - Buttons: Default (glowing), hover (brighter glow + scale 1.05), active (scale 0.98), loading (spinner), disabled (muted)
  - Connection: Disconnected (warning state), connected (success indicator), loading (pulsing animation)
  - Authentication: Unknown (checking), authenticated (logged in badge), unauthenticated (not logged in warning)
  - Copy button: Default (Copy), success (Copied! with checkmark for 3s)
  - Tabs: Default (muted), active (highlighted with bottom border and background)
  
- **Icon Selection**:
  - Rocket (app branding)
  - Gift (redemption actions and history entries)
  - Lightning (automation indicator)
  - CheckCircle (success states)
  - WarningCircle (error states)
  - CircleNotch (loading spinner and refresh action)
  - Globe (connection status)
  - ShieldCheck (authentication status)
  - ArrowSquareOut (open in new tab)
  - Code (manual script section)
  - Copy (copy to clipboard action)
  - ClockCounterClockwise (gift history icon)
  - Calendar (timestamp display)



















