// Spawns the bundled Node with responsibility disclaimed, so macOS attributes
// the server's Screen Recording and Accessibility asks to this bundle
// (dev.applecua.mcp) instead of whatever launched the server. Forwards
// termination signals and exits with the child's status.
#include <errno.h>
#include <libgen.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

// Declared here because the private SDK header that carries it is not installed
// with the CLT.
extern int responsibility_spawnattrs_setdisclaim(posix_spawnattr_t *attributes,
                                                 int disclaim);

extern char **environ;

static pid_t childPid = -1;

static void forwardSignal(int signalNumber) {
  if (childPid > 0) {
    kill(childPid, signalNumber);
  }
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: apple-cua-mcp <server.js> [server args...]\n");
    return 2;
  }

  char executablePath[PATH_MAX];
  char resolvedPath[PATH_MAX];
  char nodePath[PATH_MAX];
  uint32_t executablePathSize = sizeof(executablePath);
  if (_NSGetExecutablePath(executablePath, &executablePathSize) != 0) {
    fprintf(stderr, "apple-cua-mcp: cannot resolve its own path\n");
    return 1;
  }
  if (realpath(executablePath, resolvedPath) == NULL) {
    snprintf(resolvedPath, sizeof(resolvedPath), "%s", executablePath);
  }
  snprintf(nodePath, sizeof(nodePath), "%s/../Resources/node",
           dirname(resolvedPath));
  if (access(nodePath, X_OK) != 0) {
    fprintf(stderr, "apple-cua-mcp: bundled node missing at %s\n", nodePath);
    return 1;
  }

  char **childArgv = calloc((size_t)argc + 1, sizeof(char *));
  if (childArgv == NULL) {
    return 1;
  }
  childArgv[0] = nodePath;
  for (int i = 1; i < argc; i++) {
    childArgv[i] = argv[i];
  }

  posix_spawnattr_t attributes;
  posix_spawnattr_init(&attributes);
  if (responsibility_spawnattrs_setdisclaim(&attributes, 1) != 0) {
    fprintf(stderr, "apple-cua-mcp: responsibility disclaim unavailable; TCC "
                    "attributes to the launcher\n");
  }

  if (posix_spawn(&childPid, nodePath, NULL, &attributes, childArgv, environ) !=
      0) {
    fprintf(stderr, "apple-cua-mcp: cannot spawn %s\n", nodePath);
    posix_spawnattr_destroy(&attributes);
    free(childArgv);
    return 1;
  }
  posix_spawnattr_destroy(&attributes);
  free(childArgv);

  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_handler = forwardSignal;
  sigaction(SIGTERM, &action, NULL);
  sigaction(SIGINT, &action, NULL);
  sigaction(SIGHUP, &action, NULL);

  int status = 0;
  pid_t waited;
  while ((waited = waitpid(childPid, &status, 0)) == -1 && errno == EINTR) {
  }
  if (waited == -1) {
    return 1;
  }
  if (WIFEXITED(status)) {
    return WEXITSTATUS(status);
  }
  if (WIFSIGNALED(status)) {
    return 128 + WTERMSIG(status);
  }
  return 1;
}
