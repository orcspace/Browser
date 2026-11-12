/* Browser launcher. No embedded scripting runtime. */
#ifdef _WIN32
#include <windows.h>
#include <process.h>
#include <stdlib.h>
#include <wchar.h>
int wmain(int argc, wchar_t **argv) {
  wchar_t base[32768], engine[32768], app[32768];
  DWORD length = GetModuleFileNameW(NULL, base, 32768);
  if (!length || length >= 32000) return 1;
  wchar_t *slash = wcsrchr(base, L'\\');
  if (!slash) return 1;
  *slash = 0;
  swprintf(engine, 32768, L"%ls\\runtime\\firefox.exe", base);
  swprintf(app, 32768, L"%ls\\runtime\\browser\\application.ini", base);
  if (_wputenv_s(L"XUL_APP_FILE", app)) return 1;
  argv[0] = engine;
  intptr_t result = _wspawnv(_P_WAIT, engine, (const wchar_t *const *)argv);
  return result == -1 ? 1 : (int)result;
}
#else
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <limits.h>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif
int main(int argc, char **argv) {
  (void)argc;
  char executable[PATH_MAX], base[PATH_MAX], engine[PATH_MAX], app[PATH_MAX];
#ifdef __APPLE__
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size)) return 1;
#else
  ssize_t n = readlink("/proc/self/exe", executable, sizeof(executable) - 1);
  if (n < 0) return 1;
  executable[n] = 0;
#endif
  if (!realpath(executable, base)) return 1;
  char *slash = strrchr(base, '/');
  if (!slash) return 1;
  *slash = 0;
#ifdef __APPLE__
  const char *engine_suffix = "/firefox";
  const char *app_suffix = "/../Resources/browser/application.ini";
#else
  const char *engine_suffix = "/runtime/firefox";
  const char *app_suffix = "/runtime/browser/application.ini";
#endif
  if (snprintf(engine, sizeof(engine), "%s%s", base, engine_suffix) >= (int)sizeof(engine) ||
      snprintf(app, sizeof(app), "%s%s", base, app_suffix) >= (int)sizeof(app)) return 1;
  if (setenv("XUL_APP_FILE", app, 1)) return 1;
  argv[0] = engine;
  execv(engine, argv);
  perror("Cannot start Browser");
  return 1;
}
#endif
