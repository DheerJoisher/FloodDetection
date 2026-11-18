import 'package:material_ui/material_ui.dart';

import '../models/auth_user.dart';
import '../services/api_service.dart';
import 'alerts_screen.dart';
import 'dashboard_screen.dart';
import 'flood_monitoring_screen.dart';

class MainShell extends StatefulWidget {
  const MainShell({
    required this.api,
    required this.user,
    required this.onLogout,
    super.key,
  });

  final ApiService api;
  final AuthUser user;
  final VoidCallback onLogout;

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _selectedIndex = 0;

  static const _destinations = [
    _Destination('Dashboard', Icons.space_dashboard_outlined),
    _Destination('Flood monitoring', Icons.water_outlined),
    _Destination('Alerts', Icons.notifications_none_outlined),
  ];

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final wideLayout = constraints.maxWidth >= 900;
        if (wideLayout) return _buildWideLayout();
        return _buildCompactLayout();
      },
    );
  }

  Widget _buildWideLayout() {
    return Scaffold(
      body: SafeArea(
        child: Row(
          children: [
            SizedBox(
              width: 248,
              child: Material(
                color: const Color(0xFF102A35),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(22, 24, 16, 28),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.water,
                            color: Color(0xFF78D0CE),
                            size: 30,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              'GODAVARI\nFLOOD MONITOR',
                              style: Theme.of(context)
                                  .textTheme
                                  .labelLarge
                                  ?.copyWith(
                                    color: Colors.white,
                                    height: 1.35,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: 0.8,
                                  ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    for (var index = 0; index < _destinations.length; index++)
                      _buildWideNavigationItem(index),
                    const Spacer(),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(18, 12, 18, 8),
                      child: Row(
                        children: [
                          CircleAvatar(
                            radius: 18,
                            backgroundColor: const Color(0xFF24515E),
                            child: Text(
                              widget.user.name.isEmpty
                                  ? 'U'
                                  : widget.user.name[0].toUpperCase(),
                              style: const TextStyle(color: Colors.white),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  widget.user.name,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                Text(
                                  widget.user.role.toUpperCase(),
                                  style: const TextStyle(
                                    color: Color(0xFF9CB6BD),
                                    fontSize: 11,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    ListTile(
                      leading: const Icon(
                        Icons.logout,
                        color: Color(0xFFBCD0D5),
                      ),
                      title: const Text(
                        'Log out',
                        style: TextStyle(color: Color(0xFFBCD0D5)),
                      ),
                      onTap: widget.onLogout,
                    ),
                    const SizedBox(height: 12),
                  ],
                ),
              ),
            ),
            const VerticalDivider(
              width: 1,
              thickness: 1,
              color: Color(0xFFE3EAED),
            ),
            Expanded(
              child: Column(
                children: [
                  Container(
                    height: 68,
                    padding: const EdgeInsets.symmetric(horizontal: 28),
                    alignment: Alignment.centerRight,
                    child: Text(
                      'River monitoring • ${widget.user.email}',
                      style: const TextStyle(
                        color: Color(0xFF637982),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(28, 8, 28, 28),
                      child: _buildPages(),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildWideNavigationItem(int index) {
    final destination = _destinations[index];
    final selected = _selectedIndex == index;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
      child: ListTile(
        selected: selected,
        selectedTileColor: const Color(0xFF20414D),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        leading: Icon(
          destination.icon,
          color: selected ? const Color(0xFF78D0CE) : const Color(0xFF9CB6BD),
        ),
        title: Text(
          destination.label,
          style: TextStyle(
            color: selected ? Colors.white : const Color(0xFFBCD0D5),
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
        onTap: () => setState(() => _selectedIndex = index),
      ),
    );
  }

  Widget _buildCompactLayout() {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Godavari Flood Monitor'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 6),
            child: Center(
              child: Text(
                widget.user.role.toUpperCase(),
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
          IconButton(
            tooltip: 'Log out',
            onPressed: widget.onLogout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: Padding(padding: const EdgeInsets.all(16), child: _buildPages()),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (index) =>
            setState(() => _selectedIndex = index),
        destinations: [
          for (final destination in _destinations)
            NavigationDestination(
              icon: Icon(destination.icon),
              label: destination.label,
            ),
        ],
      ),
    );
  }

  Widget _buildPages() {
    return IndexedStack(
      index: _selectedIndex,
      children: [
        DashboardScreen(api: widget.api),
        FloodMonitoringScreen(api: widget.api),
        AlertsScreen(api: widget.api, user: widget.user),
      ],
    );
  }
}

class _Destination {
  const _Destination(this.label, this.icon);

  final String label;
  final IconData icon;
}
