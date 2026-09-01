# Screen Studio: Agent Fleet Capabilities Catalog

## Core Function
A macOS-only screen recorder that automatically adds professional polish (zoom-to-click animations, smooth cursor movements, customizable backgrounds) to raw recordings without any manual editing work.

## Key Capabilities

### Recording & Capture
- Screen recording: Full screen, selected window, or custom region
- Webcam overlay: Picture-in-picture bubble with automatic zoom-out to avoid covering cursor
- System audio: Record system audio from all apps or selected ones
- Microphone input: Record voiceover with automatic voice normalization and background noise removal
- iPhone/iPad recording: USB-connected device recording with automatic device model/color detection and device frame overlays

### Automatic Enhancements (No Editing Required)
- Auto-zoom-to-click: Detects mouse clicks and smoothly zooms in on action (signature feature)
- Cursor smoothing: Transforms jittery cursor movement into smooth gliding motion
- Cursor resizing: Change cursor size after recording
- Auto-hide static cursor: Intelligently removes cursor when it doesn't add value
- Cursor looping: Return cursor to starting position for loopable social content
- Motion blur: Natural motion effects resembling professional video editor work

### Visual Customization
- Background & spacing: Change video background, padding, and outer spacing
- Shadow & inset: Customize subtle shadow and border effects
- Export orientations: One-click conversion to vertical (9:16) or horizontal (16:9)

### Audio Enhancement
- Voice normalization: Automatic volume leveling across entire recording
- Noise removal: Background noise suppression (on-device, no data sent to servers)
- Keyboard shortcut display: Overlay keyboard shortcuts in final video for tutorials
- Transcript generation: On-device transcription to generate subtitles

### Editing (Light)
- Trim & cut, speed adjustment, manual zoom, crop, hide desktop icons

### Export & Sharing
- Video formats: MP4 and MOV at up to 4K 60fps
- GIF export: Highly optimized animated GIFs
- Shareable links, clipboard paste, platform presets
- Device frame export: Includes iPhone/iPad mockup frame

## When to Use Screen Studio

Use Screen Studio when:
- Output needs auto-zoom polish and visual clarity (launch video, SaaS demo, social clip)
- User is on macOS and can wait 5-30 minutes for render
- Viewer attention must land on small UI elements (buttons, checkboxes, menu items)
- Professional appearance is the primary goal (not speed, not cross-platform, not complex editing)
- Content is for external audience (marketing, social, tutorials) vs internal async team messages

Use an alternative when:
- User is on Windows: Camtasia, OBS, or Loom
- Need instant sharing and team integrations: Loom or Descript
- Need streaming or multi-source composition: OBS Studio
- Need timeline editing, effects, quizzes, or LMS export: Camtasia, ScreenFlow, or Descript
- Budget is zero: OBS or QuickTime
- Speed is critical (under 2 minutes to share): Loom or CleanShot X
- Recording browser content only: Zumie or Screencastify

## Limitations

### Hard Boundaries
- macOS only (no Windows, Linux, or cross-platform version; team has stated no plans for Windows)
- No live streaming (recording only)
- No multi-source layering (single screen source)
- No plugin ecosystem
- No real-time collaboration

### Workflow Limitations
- File-based sharing only (no instant share link like Loom)
- Limited annotation tools (no callouts, arrows, shapes, text overlays)
- No AI features (no transcript summarization, auto-chapters, filler-word removal)
- No viewer analytics or team/collaboration features

### Technical Constraints
- 5-30 minute render time depending on recording length and resolution
- macOS Ventura 13.1+ required
- No batch export
- Limited transcript accuracy (on-device processing)

## Pricing (2026)
- Monthly: $20.90 USD/month
- Yearly: $9/month (billed $108/year) — best value
- Free trial: 30-day full access, no CC required, no permanent free tier

## Fleet Decision Tree

```
Is the user on macOS?
  ├── Yes → Do they need auto-zoom polish for a demo/launch video?
  │         ├── Yes → Is 5-30 min render time acceptable? → SCREEN STUDIO
  │         └── No → Need speed? → Loom / CleanShot X
  └── No → Windows or cross-platform? → Camtasia / OBS / Loom

Is heavy editing needed? → Camtasia, ScreenFlow, or Descript
Is budget zero? → OBS or QuickTime (free)
Is streaming needed? → OBS Studio
```

## Complementary Tools
- iMovie / Final Cut Pro — additional post-production editing
- Descript / Adobe Premiere — transcript-based or multi-track editing
- YouTube / Vimeo — hosting and distribution
- Slack / Discord — sharing via clipboard paste
- Notion / Obsidian — embedding exported videos in documentation

## Sources
- Screen Studio official site (screen.studio): Features, pricing, documentation
- TechSmith/Camtasia comparison articles (2026)
- App store reviews and user feedback across tools

Last updated: 2026-08-14
