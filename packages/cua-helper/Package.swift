// swift-tools-version: 5.9
// MIT License

import PackageDescription

let package = Package(
	name: "cua-helper",
	platforms: [.macOS(.v14)],
	products: [
		.executable(name: "cua-helper", targets: ["CuaHelper"]),
	],
	targets: [
		.executableTarget(
			name: "CuaHelper",
			linkerSettings: [
				.linkedFramework("ScreenCaptureKit"),
				.linkedFramework("CoreImage"),
				.linkedFramework("ApplicationServices"),
			]
		),
	]
)
