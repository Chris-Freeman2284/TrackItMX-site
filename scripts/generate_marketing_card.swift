import AppKit

let repoRoot = URL(fileURLWithPath: "/Users/chrisfreeman/Documents/Playground/website", isDirectory: true)
let outputURL = repoRoot.appendingPathComponent("assets/marketing-card.png")
let iconURL = repoRoot.appendingPathComponent("assets/trackitmx-mark.png")

let size = NSSize(width: 1200, height: 630)
let width = Int(size.width)
let height = Int(size.height)

func color(_ hex: Int, alpha: CGFloat = 1) -> NSColor {
    NSColor(
        calibratedRed: CGFloat((hex >> 16) & 0xff) / 255.0,
        green: CGFloat((hex >> 8) & 0xff) / 255.0,
        blue: CGFloat(hex & 0xff) / 255.0,
        alpha: alpha
    )
}

func drawRoundedRect(_ rect: NSRect, radius: CGFloat, fill: NSColor) {
    let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    fill.setFill()
    path.fill()
}

guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: width,
    pixelsHigh: height,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    fatalError("Failed to create bitmap representation.")
}

bitmap.size = size

guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("Failed to create graphics context.")
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context

let backgroundRect = NSRect(origin: .zero, size: size)
let gradient = NSGradient(colors: [
    color(0x120d0a),
    color(0x1a120d),
    color(0x080706)
])!
gradient.draw(in: backgroundRect, angle: -18)

drawRoundedRect(NSRect(x: 36, y: 36, width: 1128, height: 558), radius: 36, fill: color(0x0f0b09, alpha: 0.84))

let borderPath = NSBezierPath(roundedRect: NSRect(x: 36, y: 36, width: 1128, height: 558), xRadius: 36, yRadius: 36)
borderPath.lineWidth = 2
color(0x7a5536, alpha: 0.38).setStroke()
borderPath.stroke()

let stripe = NSBezierPath()
stripe.move(to: NSPoint(x: 930, y: 615))
stripe.line(to: NSPoint(x: 520, y: 15))
stripe.lineWidth = 86
stripe.lineCapStyle = .round
color(0x5c3a23, alpha: 0.18).setStroke()
stripe.stroke()

let stripeInner = NSBezierPath()
stripeInner.move(to: NSPoint(x: 910, y: 615))
stripeInner.line(to: NSPoint(x: 500, y: 15))
stripeInner.lineWidth = 26
stripeInner.lineCapStyle = .round
color(0x2b1d13, alpha: 0.36).setStroke()
stripeInner.stroke()

for mud in [
    NSRect(x: 18, y: 482, width: 180, height: 120),
    NSRect(x: 1020, y: 42, width: 180, height: 150),
    NSRect(x: 850, y: 468, width: 220, height: 110)
] {
    let blob = NSBezierPath(ovalIn: mud)
    color(0x5d3e28, alpha: 0.08).setFill()
    blob.fill()
}

if let icon = NSImage(contentsOf: iconURL) {
    NSGraphicsContext.saveGraphicsState()
    let iconShadow = NSShadow()
    iconShadow.shadowBlurRadius = 28
    iconShadow.shadowOffset = NSSize(width: 0, height: -10)
    iconShadow.shadowColor = color(0x000000, alpha: 0.35)
    iconShadow.set()

    let iconRect = NSRect(x: 86, y: 180, width: 238, height: 238)
    let iconPath = NSBezierPath(roundedRect: iconRect, xRadius: 50, yRadius: 50)
    iconPath.addClip()
    icon.draw(in: iconRect)
    NSGraphicsContext.restoreGraphicsState()
}

let eyebrow = NSMutableParagraphStyle()
eyebrow.lineBreakMode = .byWordWrapping

let headerParagraph = NSMutableParagraphStyle()
headerParagraph.lineBreakMode = .byWordWrapping

let bodyParagraph = NSMutableParagraphStyle()
bodyParagraph.lineSpacing = 4

let metaParagraph = NSMutableParagraphStyle()
metaParagraph.lineBreakMode = .byTruncatingTail

let eyebrowAttributes: [NSAttributedString.Key: Any] = [
    .font: NSFont(name: "AvenirNext-DemiBold", size: 18) ?? NSFont.boldSystemFont(ofSize: 18),
    .foregroundColor: color(0xc58a53),
    .kern: 2.2,
    .paragraphStyle: eyebrow
]

let titleAttributes: [NSAttributedString.Key: Any] = [
    .font: NSFont(name: "AvenirNext-Heavy", size: 51) ?? NSFont.boldSystemFont(ofSize: 51),
    .foregroundColor: color(0xf2eadc),
    .paragraphStyle: headerParagraph
]

let bodyAttributes: [NSAttributedString.Key: Any] = [
    .font: NSFont(name: "AvenirNext-Regular", size: 22) ?? NSFont.systemFont(ofSize: 22),
    .foregroundColor: color(0xe0d3c0, alpha: 0.92),
    .paragraphStyle: bodyParagraph
]

let metaAttributes: [NSAttributedString.Key: Any] = [
    .font: NSFont(name: "AvenirNext-DemiBold", size: 15) ?? NSFont.boldSystemFont(ofSize: 15),
    .foregroundColor: color(0xe7dccd, alpha: 0.92),
    .kern: 0.4,
    .paragraphStyle: metaParagraph
]

let pillAttributes: [NSAttributedString.Key: Any] = [
    .font: NSFont(name: "AvenirNext-DemiBold", size: 17) ?? NSFont.boldSystemFont(ofSize: 17),
    .foregroundColor: color(0x1a120d)
]

NSString(string: "TRACKITMX BETA").draw(in: NSRect(x: 396, y: 500, width: 300, height: 28), withAttributes: eyebrowAttributes)

NSString(string: "Record every ride.\nReview what mattered.\nRide better next time.").draw(
    in: NSRect(x: 392, y: 286, width: 670, height: 204),
    withAttributes: titleAttributes
)

NSString(string: "Trail-first navigation, trusted ride recording, post-ride review, group ride visibility, and garage memory for off-road riders.").draw(
    in: NSRect(x: 396, y: 170, width: 640, height: 92),
    withAttributes: bodyAttributes
)

let pillRect = NSRect(x: 396, y: 108, width: 228, height: 42)
drawRoundedRect(pillRect, radius: 21, fill: color(0xc58a53))
NSString(string: "iPhone beta on TestFlight").draw(
    in: NSRect(x: pillRect.minX + 17, y: pillRect.minY + 10, width: pillRect.width - 34, height: 22),
    withAttributes: pillAttributes
)

NSString(string: "trackitmx.com").draw(
    in: NSRect(x: 396, y: 72, width: 180, height: 22),
    withAttributes: metaAttributes
)

NSString(string: "Navigation  •  Group ride  •  Watch + CarPlay beta").draw(
    in: NSRect(x: 632, y: 72, width: 430, height: 22),
    withAttributes: metaAttributes
)

NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Failed to encode marketing card PNG.")
}

try png.write(to: outputURL)
print("Wrote \(outputURL.path)")
