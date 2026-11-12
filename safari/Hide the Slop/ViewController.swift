//
//  ViewController.swift
//  Hide the Slop
//
//  The app's one window: a page (Resources/Base.lproj/Main.html) saying whether the
//  extension is on and what it does, with a button that opens Safari's Extensions settings.
//

import Cocoa
import SafariServices
import WebKit

// From Info.plist, which gets it from HTS_EXTENSION_BUNDLE_ID in Shared.xcconfig, so the
// app always asks about the extension it was built with.
let extensionBundleIdentifier = Bundle.main.object(forInfoDictionaryKey: "HTSExtensionBundleIdentifier") as? String ?? ""

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    // Set once the window's own page has started loading, so no later file: link can
    // replace it.
    private var pageLoaded = false

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(self, name: "controller")

        // The app keeps its outgoing-connections entitlement only for this: in the sandbox,
        // WKWebView draws nothing at all without it, even for a page inside the app. The
        // page itself can't reach the network, because the CSP is default-src 'self' and
        // every link is handed to NSWorkspace below.
        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)

        // You turn the extension on in Safari, then come back here, so ask again each time
        // the app comes to the front rather than showing what was true at launch.
        NotificationCenter.default.addObserver(self, selector: #selector(appBecameActive), name: NSApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func appBecameActive() {
        showState()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        switch LinkPolicy.decide(url, pageLoaded: pageLoaded) {
        case .load:
            if url?.isFileURL == true {
                pageLoaded = true
            }
            decisionHandler(.allow)
        case .openOutside:
            decisionHandler(.cancel)
            if let url = url {
                NSWorkspace.shared.open(url)
            }
        case .refuse:
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // The email link carries the version, as the one in the extension's Settings does,
        // so a report says which build it's about. JSON makes it a safe JavaScript string.
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        if let data = try? JSONEncoder().encode(version), let quoted = String(data: data, encoding: .utf8) {
            webView.evaluateJavaScript("setVersion(\(quoted))")
        }
        showState()
    }

    private func showState() {
        // Until the page has loaded there's no show() to call. didFinish asks then.
        guard pageLoaded, !webView.isLoading else {
            return
        }
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            guard let state = state, error == nil else {
                // The page keeps its "don't know" wording, which still says where to look.
                return
            }

            DispatchQueue.main.async {
                self.webView.evaluateJavaScript("show(\(state.isEnabled))")
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if (message.body as? String != "open-preferences") {
            return;
        }

        // The window stays open afterwards: an app that vanishes on a click looks like a
        // crash to someone trying it for the first time, App Review included.
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            DispatchQueue.main.async {
                self.webView.evaluateJavaScript("settingsOpened(\(error == nil))")
            }
        }
    }

}
