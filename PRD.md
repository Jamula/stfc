# Planning Guide

A mobile-first web app that helps Star Trek Fleet Command players track and claim free gifts from the game's web store, ensuring they never miss limited-time rewards.

**Experience Qualities**:
1. **Tactical** - Clear, immediate visibility of available gifts with claim status, mimicking the urgency and precision of fleet operations
2. **Streamlined** - One-tap interactions for marking gifts as claimed, minimizing friction in the claiming workflow
3. **Immersive** - Star Trek aesthetic that feels native to the STFC universe with sci-fi inspired design elements

**Complexity Level**: Light Application (multiple features with basic state)
This is a gift tracking tool with multiple interactive cards, persistent state for claimed items, and filtering capabilities—more than a simple display but less complex than a full fleet management system.

## Essential Features

### Gift Card Display
- **Functionality**: Displays each available gift with image, title, description, quantity remaining, and status badges
- **Purpose**: Provides quick visual overview of all available rewards
- **Trigger**: On app load
- **Progression**: App loads → Gifts render in grid → User scans available items → Identifies unclaimed gifts
- **Success criteria**: All gifts visible with clear status indicators, responsive grid layout adapts to screen size

### Claim Tracking
- **Functionality**: Toggle claim status with visual confirmation, persists across sessions
- **Purpose**: Prevents duplicate claiming attempts and tracks redemption history
- **Trigger**: User taps "Claim" button on gift card
- **Progression**: User taps Claim → Button animates → Status updates to "Claimed" → State persists → Visual feedback confirms
- **Success criteria**: Claim status saves reliably, visual state updates immediately, claimed items show distinct appearance

### Gift Categories
- **Functionality**: Filter gifts by type (Daily, Limited Time, Permanent, etc.)
- **Purpose**: Helps users prioritize time-sensitive rewards
- **Trigger**: User selects category filter
- **Progression**: User taps category → Grid filters instantly → Count updates → User views subset
- **Success criteria**: Smooth filtering without page reload, clear active category indicator

### Reset Functionality
- **Functionality**: Clear all claimed statuses to start fresh
- **Purpose**: Allows users to reset tracking for new reward cycles
- **Trigger**: User accesses settings/menu and confirms reset
- **Progression**: User taps menu → Selects Reset → Confirmation dialog → User confirms → All claims cleared → Toast notification
- **Success criteria**: Confirmation prevents accidental resets, all gifts return to unclaimed state

## Edge Case Handling

- **Empty States**: Show encouraging message when all gifts in a category are claimed with celebratory micro-animation
- **No Gifts Available**: Display helpful message if gift data is unavailable with suggestion to check back later
- **Rapid Claiming**: Debounce claim button to prevent double-taps causing state conflicts
- **Data Persistence Failure**: Graceful fallback with toast notification if KV storage fails

## Design Direction

The design should evoke the feeling of a Starfleet LCARS interface—bold geometric shapes, confident typography, and a color palette inspired by deep space and starship consoles. Users should feel like they're accessing a tactical database aboard their vessel, with efficient information hierarchy and satisfying interactions that feel precise and purposeful.

## Color Selection

A bold sci-fi palette combining deep space blacks with vibrant neon accents reminiscent of warp plasma and starship HUDs.

- **Primary Color**: Electric Blue (oklch(0.65 0.18 240)) - Represents dilithium energy and advanced technology, used for primary CTAs and active states
- **Secondary Colors**: Deep Space Navy (oklch(0.15 0.02 250)) for backgrounds; Starship Gray (oklch(0.25 0.01 250)) for cards and surfaces
- **Accent Color**: Warp Plasma Green (oklch(0.75 0.20 145)) - High-energy highlight for claim buttons and success states, creates urgency
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

Animations should feel like starship console interactions—crisp, purposeful, and satisfying. Use subtle glows and scale transforms to create tactile feedback. Key moments: claim button press (scale + glow pulse), card appearance (fade up with slight delay stagger), filter transitions (smooth height changes), and success states (brief shimmer effect). Keep durations snappy (150-250ms) to maintain the feeling of responsive, advanced technology.

## Component Selection

- **Components**:
  - Card: Gift containers with hover effects and border glow on unclaimed items
  - Button: Primary for "Claim" actions with disabled state for claimed gifts; use variant styling for different states
  - Badge: Status indicators (Limited Time, Daily Gift, Claimed) with color-coded urgency
  - Tabs: Category filtering across the top for gift types
  - Dialog: Confirmation modal for reset action with destructive button variant
  - Separator: Dividers between gift sections with subtle neon glow
  - Sheet: Mobile menu drawer for settings and reset functionality
  
- **Customizations**:
  - Custom GiftCard component wrapping Card with status overlay and claim button integration
  - Hexagonal badge shapes using clip-path for LCARS-style angular geometry
  - Glowing borders using box-shadow with theme colors for unclaimed items
  
- **States**:
  - Buttons: Default (glowing), hover (brighter glow + scale 1.05), active (scale 0.98), disabled (muted with reduced opacity)
  - Cards: Default (subtle border), hover (elevated shadow + border glow), claimed (muted with checkmark overlay)
  - Badges: Static with pulsing animation for time-sensitive items
  
- **Icon Selection**:
  - Gift (for unclaimed gifts)
  - CheckCircle (for claimed status)
  - FunnelSimple (for filter/category)
  - ArrowCounterClockwise (for reset)
  - DotsThreeVertical (for menu)
  - Clock (for limited time indicators)
  
- **Spacing**:
  - Container padding: px-4 md:px-6 (16px/24px)
  - Card gaps: gap-4 md:gap-6 (16px/24px responsive)
  - Section spacing: space-y-6 md:space-y-8
  - Card internal padding: p-4 md:p-6
  
- **Mobile**:
  - Single column card grid on mobile, 2 columns on tablet (md), 3 columns on desktop (lg)
  - Sticky header with category tabs that scroll horizontally on mobile
  - Bottom sheet for settings instead of dropdown menu
  - Touch-optimized button sizes (min 44px tap targets)
  - Swipe gesture consideration for marking as claimed (future enhancement)
