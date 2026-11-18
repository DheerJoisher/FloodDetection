import 'package:material_ui/material_ui.dart';

import '../models/dashboard_stats.dart';
import '../services/api_service.dart';
import '../widgets/risk_badge.dart';
import '../widgets/stat_card.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({required this.api, super.key});

  final ApiService api;

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  DashboardStats? _stats;
  String? _error;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final stats = await widget.api.getDashboardStats();
      if (mounted) setState(() => _stats = stats);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Dashboard',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: const Color(0xFF16313B),
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Current overview from the Godavari flood dataset.',
                    style: TextStyle(color: Color(0xFF687D86)),
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Refresh dashboard',
              onPressed: _isLoading ? null : _loadStats,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        const SizedBox(height: 20),
        Expanded(child: _buildBody()),
      ],
    );
  }

  Widget _buildBody() {
    if (_isLoading && _stats == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _stats == null) {
      return _ErrorPanel(message: _error!, onRetry: _loadStats);
    }

    final stats = _stats;
    if (stats == null) {
      return const Center(child: Text('No dashboard data is available.'));
    }

    return RefreshIndicator(
      onRefresh: _loadStats,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_error != null) ...[
              _InlineError(message: _error!),
              const SizedBox(height: 12),
            ],
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: const Color(0xFFEAF5F5),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFD8EDED)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.water, color: Color(0xFF087E8B), size: 28),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Godavari basin monitoring',
                          style: TextStyle(
                            color: Color(0xFF16313B),
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        SizedBox(height: 4),
                        Text(
                          'Statistics and readings are fetched from the backend API.',
                          style: TextStyle(color: Color(0xFF5D747D)),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  if (stats.latestRiskLevel != null)
                    RiskBadge(level: stats.latestRiskLevel!),
                ],
              ),
            ),
            const SizedBox(height: 18),
            LayoutBuilder(
              builder: (context, constraints) {
                final columns = constraints.maxWidth >= 1180
                    ? 4
                    : constraints.maxWidth >= 720
                    ? 2
                    : 1;
                final spacing = 14.0;
                final cardWidth =
                    (constraints.maxWidth - spacing * (columns - 1)) / columns;
                return Wrap(
                  spacing: spacing,
                  runSpacing: spacing,
                  children: [
                    SizedBox(
                      width: cardWidth,
                      child: StatCard(
                        label: 'Flood records',
                        value: _formatInteger(stats.totalRecords),
                        icon: Icons.dataset_outlined,
                        accent: const Color(0xFF087E8B),
                      ),
                    ),
                    SizedBox(
                      width: cardWidth,
                      child: StatCard(
                        label: 'Monitoring stations',
                        value: '${stats.stationCount}',
                        icon: Icons.location_on_outlined,
                        accent: const Color(0xFF4F6BED),
                      ),
                    ),
                    SizedBox(
                      width: cardWidth,
                      child: StatCard(
                        label: 'Latest date',
                        value: _formatDate(stats.latestDate),
                        icon: Icons.calendar_month_outlined,
                        accent: const Color(0xFF9A6700),
                      ),
                    ),
                    SizedBox(
                      width: cardWidth,
                      child: StatCard(
                        label: 'Latest water level',
                        value: _formatValue(stats.latestWaterlevel),
                        icon: Icons.water_drop_outlined,
                        accent: const Color(0xFF087E8B),
                      ),
                    ),
                    SizedBox(
                      width: cardWidth,
                      child: StatCard(
                        label: 'Latest discharge',
                        value: _formatValue(stats.latestDischarge),
                        icon: Icons.waves_outlined,
                        accent: const Color(0xFF4F6BED),
                      ),
                    ),
                    SizedBox(
                      width: cardWidth,
                      child: StatCard(
                        label: 'Latest rainfall',
                        value: _formatValue(stats.latestRainfall),
                        icon: Icons.grain,
                        accent: const Color(0xFF9A6700),
                      ),
                    ),
                    SizedBox(
                      width: cardWidth,
                      child: StatCard(
                        label: 'Current risk level',
                        value: stats.latestRiskLevel ?? '—',
                        icon: Icons.shield_outlined,
                        accent: _riskColor(stats.latestRiskLevel),
                        caption: 'Academic rule-based estimate',
                      ),
                    ),
                  ],
                );
              },
            ),
            const SizedBox(height: 16),
            const Text(
              'Risk levels are academic estimates and are not official government warnings.',
              style: TextStyle(color: Color(0xFF71848C), fontSize: 12),
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
  }
}

String _formatInteger(int value) {
  final text = value.toString();
  return text.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
}

String _formatValue(double? value) => value?.toStringAsFixed(2) ?? '—';

String _formatDate(String? value) {
  if (value == null || value.isEmpty) return '—';
  return DateTime.tryParse(value)?.toIso8601String().substring(0, 10) ?? value;
}

Color _riskColor(String? level) => switch (level?.toUpperCase()) {
  'HIGH' => const Color(0xFFB42318),
  'MODERATE' => const Color(0xFF9A6700),
  _ => const Color(0xFF18794E),
};

class _ErrorPanel extends StatelessWidget {
  const _ErrorPanel({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.cloud_off_outlined,
              size: 42,
              color: Color(0xFF83949C),
            ),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Try again'),
            ),
          ],
        ),
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFEEEC),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(message, style: const TextStyle(color: Color(0xFFB42318))),
    );
  }
}
