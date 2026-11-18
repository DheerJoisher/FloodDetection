import 'package:flutter/foundation.dart';
import 'package:material_ui/material_ui.dart';

import 'models/auth_user.dart';
import 'screens/login_screen.dart';
import 'screens/main_shell.dart';
import 'services/api_service.dart';

// Temporary local-development bypass; it is ignored outside debug builds.
const bool _devBypassLogin =
    kDebugMode && bool.fromEnvironment('DEV_BYPASS_LOGIN', defaultValue: false);

void main() {
  runApp(const FloodMonitoringApp());
}

class FloodMonitoringApp extends StatefulWidget {
  const FloodMonitoringApp({super.key});

  @override
  State<FloodMonitoringApp> createState() => _FloodMonitoringAppState();
}

class _FloodMonitoringAppState extends State<FloodMonitoringApp> {
  late final ApiService _api;
  AuthUser? _user;

  @override
  void initState() {
    super.initState();
    _api = ApiService();
    if (_devBypassLogin) {
      _user = const AuthUser(
        id: 'development-session',
        name: 'Development session',
        email: '',
        role: 'development',
      );
    }
  }

  @override
  void dispose() {
    _api.dispose();
    super.dispose();
  }

  void _onLogin(AuthUser user) {
    setState(() => _user = user);
  }

  void _onLogout() {
    _api.logout();
    setState(() => _user = null);
  }

  @override
  Widget build(BuildContext context) {
    const seedColor = Color(0xFF087E8B);
    return MaterialApp(
      title: 'Godavari Flood Monitor',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: seedColor,
          surface: const Color(0xFFF5F8FA),
        ),
        scaffoldBackgroundColor: const Color(0xFFF5F8FA),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFFF5F8FA),
          foregroundColor: Color(0xFF16313B),
          elevation: 0,
          centerTitle: false,
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFDCE5E9)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFDCE5E9)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: seedColor, width: 1.5),
          ),
        ),
      ),
      home: _user == null
          ? LoginScreen(api: _api, onLogin: _onLogin)
          : MainShell(api: _api, user: _user!, onLogout: _onLogout),
    );
  }
}
