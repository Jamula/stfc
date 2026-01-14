# Planning Guide

A mobile-first web app that automatically redeems free gifts from the Star Trek Fleet Command web store by interfacing with https://home.startrekfleetcommand.com/store, eliminating manual claiming and ensuring players never miss rewards.

**Experience Qualities**:
1. **Automated** - One-click redemption of all available gifts with real-time status updates and visual feedback
2. **Reliable** - Robust error handling with clear messaging when authentication or redemption fails
3. **Immersive** - Star Trek aesthetic that feels native to the STFC universe with sci-fi inspired design elements

**Complexity Level**: Light Application (multiple features with basic state)
This is an automated gift redemption tool that interfaces with an external website, handles authentication, and provides real-time feedback—a focused utility app with persistent configuration.

## Essential Features

### Store Website Integration
- **Functionality**: Opens the STFC store website in an embedded iframe with authentication flow
- **Purpose**: Provides secure access to the actual gift redemption interface
- **Trigger**: On app load or when user initiates connection
- **Progression**: App loads → User authenticates with STFC account → Store loads in iframe → User can interact with store
- **Success criteria**: Iframe loads correctly, authentication persists, user can navigate store seamlessly

### Automated Gift Redemption
- **Functionality**: Automatically identifies and redeems all available free gifts with one click using JavaScript DOM manipulation
- **Purpose**: Eliminates tedious manual clicking through multiple gift pages
- **Trigger**: User clicks "Redeem All Gifts" button
- **Progression**: User clicks button → Script accesses iframe DOM → Scans for gift/free/claim buttons → Each gift clicked automatically with confirmation → Progress shown in real-time → Completion summary displayed
- **Success criteria**: All free gifts successfully redeemed, clear progress feedback, error handling for failed redemptions, graceful fallback for cross-origin restrictions

### Manual Script Alternative
- **Functionality**: Provides a copy-paste JavaScript snippet users can run directly in the STFC store tab's console
- **Purpose**: Bypass cross-origin iframe restrictions when automated clicking from iframe fails
- **Trigger**: Displayed below control panel as alternative method
- **Progression**: User copies script → Opens store in new tab → Opens browser console (F12) → Pastes script → Script runs and auto-claims gifts
- **Success criteria**: Script successfully scans and clicks gift buttons, handles confirmations, provides console logging of progress

### Authentication Management
- **Functionality**: Securely stores authentication state for the STFC website
- **Purpose**: Prevents repeated login prompts while maintaining security
- **Trigger**: User authenticates through the embedded store
- **Progression**: User logs in → Auth state detected → Credentials cached (if browser allows) → User remains logged in
- **Success criteria**: Authentication persists across sessions, secure handling of credentials

### Manual Gift Access
- **Functionality**: Allows users to manually browse and claim specific gifts
- **Purpose**: Provides fallback when automation fails or user wants control
- **Trigger**: User interacts with embedded store directly
- **Progression**: User views store → Clicks on desired gift → Manual redemption through native interface
- **Success criteria**: Full store functionality accessible, no interference from automation layer

## Edge Case Handling

- **Authentication Failures**: Clear error message with retry option when login fails or session expires
- **CORS/Cross-Origin Issues**: Graceful handling with iframe automation attempt first, then fallback to manual script copy-paste method with clear instructions
- **Network Errors**: Retry mechanism with exponential backoff for failed redemption attempts
- **No Gifts Available**: Display encouraging message when all gifts have been claimed with next reset timer
- **Partial Redemption Failures**: Continue processing remaining gifts even if one fails, report failures at end
- **Browser Compatibility**: Fallback to direct link if iframe features are unsupported
- **DOM Structure Changes**: Flexible selectors that search for multiple button patterns (gift, free, claim, redeem keywords in text, classes, and IDs)
- **Confirmation Dialogs**: Script automatically detects and clicks confirmation buttons after clicking gift buttons

## Design Direction

The design should feel like accessing a Starfleet command interface overlay on top of the official store—a tactical HUD that enhances the native experience. The embedded store should be the focus, with our automation controls floating above it in a sleek, semi-transparent control panel that doesn't obstruct the view. Users should feel like they're using advanced fleet technology to streamline their operations.

## Color Selection

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
  - Card: Floating control panel with backdrop blur and semi-transparent background; Manual script card with code display
  - Button: Primary "Redeem All Gifts" button with loading states; secondary "Open Store" button; "Copy Script" button for manual approach
  - Progress: Linear progress bar for redemption status with percentage display
  - Badge: Status indicators showing connection state and redemption count
  - Alert: Error notifications for failed operations; informational alerts about cross-origin restrictions
  - Dialog: Confirmation modal for bulk redemption with summary
  - Separator: Dividers in control panel with subtle neon glow
  - Code Block: Syntax-highlighted script display with copy functionality
  
- **Customizations**:
  - Custom iframe wrapper component with loading overlay and error states
  - Floating control panel that can be minimized/expanded
  - Progress indicator with animated gradient fill
  - Status badge with pulsing animation for active operations
  - Script generator component with formatted code display and one-click copy
  
- **States**:
  - Buttons: Default (glowing), hover (brighter glow + scale 1.05), active (scale 0.98), loading (spinner), disabled (muted)
  - Control panel: Expanded (full controls visible), minimized (compact bar), hidden (only toggle visible)
  - Connection: Disconnected (warning state), connected (success indicator), loading (pulsing animation)
  - Copy button: Default (Copy), success (Copied! with checkmark for 3s)
  
- **Icon Selection**:
  - Rocket (app branding)
  - Gift (redemption actions)
  - Lightning (automation indicator)
  - CheckCircle (success states)
  - WarningCircle (error states)
  - CircleNotch (loading spinner)
  - CaretUp/CaretDown (panel expand/collapse)
  - ArrowSquareOut (open in new tab)
  - Code (manual script section)
  - Copy (copy to clipboard action)
  
- **Spacing**:
  - Control panel padding: p-4 md:p-6
  - Button spacing: gap-3 md:gap-4
  - Status indicators: gap-2
  - Panel margin from edges: m-4 md:m-6
  - Script card spacing: space-y-4 between elements
  
- **Mobile**:
  - Control panel anchored to top on mobile, floats on desktop
  - Touch-optimized button sizes (min 44px tap targets)
  - Collapsible panel to maximize iframe viewport
  - Swipe down to dismiss/minimize control panel
  - Full-screen iframe option for focused interaction
  - Script code block with horizontal scroll for long lines
