import Darwin
import Foundation

let path = CommandLine.arguments[1]
let directory = URL(fileURLWithPath: path).deletingLastPathComponent().path
let descriptor = open(directory, O_EVTONLY)
guard descriptor >= 0 else { exit(1) }
let source = DispatchSource.makeFileSystemObjectSource(
	fileDescriptor: descriptor, eventMask: [.write, .rename, .delete], queue: .main)
source.setEventHandler {
	print("CHANGED")
	fflush(stdout)
}
source.setCancelHandler { close(descriptor) }
source.setRegistrationHandler {
	print("READY")
	fflush(stdout)
}
source.resume()
DispatchQueue.global().async {
	while readLine() != nil {}
	DispatchQueue.main.async {
		source.cancel()
		exit(0)
	}
}
dispatchMain()
