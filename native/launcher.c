/* Browser launcher. No embedded scripting runtime. */
#ifdef _WIN32
#include <windows.h>
#include <process.h>
#include <stdlib.h>
#include <wchar.h>
static wchar_t *quote_argument(const wchar_t *value) {
  size_t length = wcslen(value);
  wchar_t *quoted = calloc(length * 2 + 3, sizeof(wchar_t));
  if (!quoted) return NULL;
  wchar_t *out = quoted;
  *out++ = L'"';
  size_t slashes = 0;
  for (const wchar_t *p = value; ; ++p) {
    if (*p == L'\\') { ++slashes; continue; }
    size_t count = (*p == L'"' || !*p) ? slashes * 2 : slashes;
    while (count--) *out++ = L'\\';
    slashes = 0;
    if (!*p) break;
    if (*p == L'"') *out++ = L'\\';
    *out++ = *p;
  }
  *out++ = L'"';
  *out = 0;
  return quoted;
}
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
  wchar_t **arguments = calloc((size_t)argc + 1, sizeof(wchar_t *));
  if (!arguments) return 1;
  for (int i = 0; i < argc; ++i) {
    arguments[i] = quote_argument(i ? argv[i] : engine);
    if (!arguments[i]) return 1;
  }
  intptr_t result = _wspawnv(_P_WAIT, engine, (const wchar_t *const *)arguments);
  for (int i = 0; i < argc; ++i) free(arguments[i]);
  free(arguments);
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
