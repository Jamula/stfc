# Planning Guide

**Experience Qualities**:

**Experience Qualities**:
1. **Automated** - One-click redemption of all available gifts with real-time status updates and visual feedback
2. **Reliable** - Robust error handling with clear messaging when authentication or redemption fails
3. **Immersive** - Star Trek aesthetic that feels native to the STFC universe with sci-fi inspired design elements

### Gift History Tracker
- **Purpose**: Provides users with a record of rewards claimed over time, helps track daily patterns



- **Trigger**: On app lo
- **Success criteria**: Iframe loads correctly, authentication persists, user can navigate store
### Automated Gift Redemption
- **Purpose**: Eliminates tedious manual clicking through multiple gift p
- **Progression**: User clicks button → Script accesses iframe DOM → Scans for gift/free/claim buttons → Each gift clicked automatically with confirm


- **Trigger**: Displayed belo
- **Success criteria**: Script successfully scans and clicks gift buttons, handles confirmations
### Authentication Management
- **Purpose**: Informs users when they need to authenticate 
- **Progression**: User logs in → Auth state detected → Auth status badge updates → Warning explains session limitations


- **Trigger**: User interacts
- **Success criteria**: Full store functionality accessible, no interference from automation layer
## Edge Case Handling
- **Authentication Failures**: Clear error message w
- **Iframe Session Persistence**: Due to browser security (same-origin policy), embedded iframe login sessions cannot persist between page reloads—app clearly explains this limitation and provides "Open Store in New
- **No Gifts Available**: Display encouraging message when all gifts have been claimed with next reset timer

- **Confirmation Dialogs**: S
## Design Direction
The design should feel like accessing a Starfleet command interface—a tactical HUD that provides
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



















