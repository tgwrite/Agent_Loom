// Windows executable shim for the plugin's literal spawn("pi", ..., shell:false).
// It selects the pinned local Pi CLI; it does not implement any plugin behavior.
using System;
using System.Diagnostics;
using System.Text;
using System.IO;
class PiLauncher {
    static string Quote(string value) {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') result.Append('\\', slashes * 2 + 1);
            else result.Append('\\', slashes);
            result.Append(c);
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }
    static int Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = new UTF8Encoding(false);
        var argv = new StringBuilder(Quote(Environment.GetEnvironmentVariable("LOOM_TEST_PI_CLI")));
        foreach (string arg in args) argv.Append(" ").Append(Quote(arg));
        var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("LOOM_TEST_NODE"), argv.ToString());
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.StandardOutputEncoding = Encoding.UTF8;
        start.StandardErrorEncoding = Encoding.UTF8;
        using (var child = Process.Start(start)) {
            var stdout = child.StandardOutput.ReadToEndAsync();
            var stderr = child.StandardError.ReadToEndAsync();
            child.WaitForExit();
            Console.Out.Write(stdout.Result);
            Console.Error.Write(stderr.Result);
            var trace = Environment.GetEnvironmentVariable("LOOM_TEST_CHILD_TRACE");
            if (!String.IsNullOrEmpty(trace)) File.WriteAllText(Path.Combine(trace, Guid.NewGuid().ToString() + ".local.txt"),
                "Exit: " + child.ExitCode + "\nSTDOUT\n" + stdout.Result + "\nSTDERR\n" + stderr.Result);
            return child.ExitCode;
        }
    }
}
