import ExpoModulesCore
import QuickLook

/**
 * A single file for QLPreviewController to show.
 *
 * QLPreviewItem is a protocol, not a concrete type, so previewing anything at
 * all requires a class that adopts it.
 */
private final class PreviewItem: NSObject, QLPreviewItem {
  let previewItemURL: URL?
  let previewItemTitle: String?

  init(url: URL, title: String?) {
    self.previewItemURL = url
    self.previewItemTitle = title
  }
}

/**
 * Retained by the module, not by the controller.
 *
 * QLPreviewController holds its dataSource weakly. A data source created inline
 * at presentation time is released the moment the call returns, and the preview
 * comes up blank — so the module keeps a strong reference for the lifetime of
 * the presentation.
 */
private final class PreviewDataSource: NSObject, QLPreviewControllerDataSource {
  private let items: [PreviewItem]

  init(items: [PreviewItem]) {
    self.items = items
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
    items.count
  }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    items[index]
  }
}

public class QuickLookModule: Module {
  /** Held so the weakly-referenced data source outlives the present() call. */
  private var dataSource: PreviewDataSource?

  public func definition() -> ModuleDefinition {
    Name("QuickLook")

    /**
     * True when the given file is something Quick Look can actually render.
     *
     * Checked before presenting rather than after: an unsupported type shows an
     * empty sheet with no explanation, which reads as the app being broken. The
     * caller can fall back to its own viewer instead.
     */
    Function("canPreview") { (uri: String) -> Bool in
      guard let url = Self.fileURL(from: uri) else { return false }
      return QLPreviewController.canPreview(url as QLPreviewItem)
    }

    /**
     * Presents Apple's own previewer, with its share, markup and print chrome.
     *
     * `uris` rather than a single path so paging between a warranty's
     * attachments works the way it does in Files and Mail — the same gesture
     * people already know.
     */
    AsyncFunction("presentAsync") { (uris: [String], startIndex: Int, title: String?) in
      let items: [PreviewItem] = uris.compactMap { uri in
        guard let url = Self.fileURL(from: uri) else { return nil }
        return PreviewItem(url: url, title: title)
      }

      guard !items.isEmpty else {
        throw NoPreviewableFileException()
      }

      guard let presenter = Self.topViewController() else {
        throw NoPresenterException()
      }

      let source = PreviewDataSource(items: items)
      self.dataSource = source

      let controller = QLPreviewController()
      controller.dataSource = source
      // Clamped: an out-of-range index crashes QLPreviewController outright.
      controller.currentPreviewItemIndex = max(0, min(startIndex, items.count - 1))

      presenter.present(controller, animated: true)
    }
    .runOnQueue(.main)
  }

  /**
   * Accepts both `file://` URLs and bare paths.
   *
   * Attachment uris in this app come from several sources — the image picker,
   * the document picker, the share extension — and they are not consistent
   * about the scheme.
   */
  private static func fileURL(from uri: String) -> URL? {
    if uri.hasPrefix("file://") {
      guard let url = URL(string: uri) else { return nil }
      return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
    let url = URL(fileURLWithPath: uri)
    return FileManager.default.fileExists(atPath: url.path) ? url : nil
  }

  /**
   * Walks past anything already presented.
   *
   * Attachments are opened from inside a modal often enough that presenting on
   * the root controller alone silently does nothing.
   */
  private static func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }

    guard let root = (scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first)?.rootViewController else {
      return nil
    }

    var top = root
    while let presented = top.presentedViewController, !presented.isBeingDismissed {
      top = presented
    }
    return top
  }
}

private class NoPreviewableFileException: Exception {
  override var reason: String {
    "None of the given files exist on disk or can be previewed."
  }
}

private class NoPresenterException: Exception {
  override var reason: String {
    "No view controller was available to present the preview from."
  }
}
