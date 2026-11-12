//
//  SafariWebExtensionHandler.swift
//  Hide the Slop Extension
//
//  Safari needs a handler in every web extension's app extension. Hide the Slop never
//  sends native messages, so this only answers with an empty reply, and it logs nothing,
//  because a message could hold whatever the page had.
//

import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: [ NSExtensionItem() ], completionHandler: nil)
    }

}
