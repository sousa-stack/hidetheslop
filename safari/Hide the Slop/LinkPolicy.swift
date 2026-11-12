//
//  LinkPolicy.swift
//  Hide the Slop
//
//  What the app's window does with a link. Only Foundation, so it can be checked without
//  opening a window.
//

import Foundation

enum LinkPolicy: Equatable {
    case load
    case openOutside
    case refuse

    // The window shows one page from inside the app and nothing else. Its own page loads
    // once; web and email links go to your browser or email app, where you can see where
    // they lead; anything else, including a second file: page, goes nowhere.
    static func decide(_ url: URL?, pageLoaded: Bool) -> LinkPolicy {
        guard let url = url, let scheme = url.scheme?.lowercased() else {
            return .refuse
        }
        switch scheme {
        case "file":
            return pageLoaded ? .refuse : .load
        case "about":
            return url.absoluteString == "about:blank" ? .load : .refuse
        case "https", "mailto":
            return .openOutside
        default:
            return .refuse
        }
    }
}
