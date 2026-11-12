//
//  ViewController.swift
//  Hide the Slop
//
//  The app's one window: a page (Resources/Base.lproj/Main.html) saying whether the
//  extension is on, with a button that opens Safari's Extensions settings.
//

import Cocoa
import SafariServices
import WebKit

// From Info.plist, which gets it from HTS_EXTENSION_BUNDLE_ID in Shared.xcconfig, so the
// app always asks about the extension it was built with.
let extensionBundleIdentifier = Bundle.main.object(forInfoDictionaryKey: "HTSExtensionBundleIdentifier") as? String ?? ""

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            guard let state = state, error == nil else {
                // The page keeps its "don't know" wording, which still says where to look.
                return
            }

            DispatchQueue.main.async {
                webView.evaluateJavaScript("show(\(state.isEnabled))")
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if (message.body as? String != "open-preferences") {
            return;
        }

        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            DispatchQueue.main.async {
                NSApplication.shared.terminate(nil)
            }
        }
    }

}
