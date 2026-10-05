import AppKit
import Foundation

struct PasteboardEntry: Codable {
    let flavors: [String: Data]
}

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: clipboard save|restore /tmp/cua-bench/clipboard.plist\n", stderr)
    exit(2)
}

let destination = URL(fileURLWithPath: CommandLine.arguments[2])
let clipboard = NSPasteboard.general

do {
    switch CommandLine.arguments[1] {
    case "save":
        let entries = (clipboard.pasteboardItems ?? []).map { item in
            PasteboardEntry(flavors: item.types.reduce(into: [String: Data]()) { flavors, kind in
                flavors[kind.rawValue] = item.data(forType: kind)
            })
        }
        try PropertyListEncoder().encode(entries).write(to: destination, options: .atomic)
    case "restore":
        let entries = try PropertyListDecoder().decode([PasteboardEntry].self, from: Data(contentsOf: destination))
        let items = entries.map { entry in
            let item = NSPasteboardItem()
            for (kind, bytes) in entry.flavors {
                item.setData(bytes, forType: NSPasteboard.PasteboardType(kind))
            }
            return item
        }
        clipboard.clearContents()
        if !items.isEmpty && !clipboard.writeObjects(items) {
            throw NSError(domain: "bench-v2", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not restore clipboard"])
        }
    default:
        fputs("Unknown clipboard operation\n", stderr)
        exit(2)
    }
} catch {
    fputs("Clipboard operation failed: \(error)\n", stderr)
    exit(1)
}
