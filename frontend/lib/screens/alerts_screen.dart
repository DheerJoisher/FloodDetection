import 'package:material_ui/material_ui.dart';

import '../models/alert.dart';
import '../models/auth_user.dart';
import '../services/api_service.dart';
import '../widgets/alert_form_dialog.dart';
import '../widgets/risk_badge.dart';

class AlertsScreen extends StatefulWidget {
  const AlertsScreen({required this.api, required this.user, super.key});

  final ApiService api;
  final AuthUser user;

  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  List<FloodAlert> _alerts = [];
  String? _error;
  bool _isLoading = true;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _loadAlerts();
  }

  Future<void> _loadAlerts() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final alerts = await widget.api.getAlerts();
      if (mounted) setState(() => _alerts = alerts);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _createAlert() async {
    final values = await showDialog<Map<String, String?>>(
      context: context,
      builder: (context) => const AlertFormDialog(),
    );
    if (values == null || !mounted) return;

    setState(() {
      _isSaving = true;
      _error = null;
    });
    try {
      final alert = await widget.api.createAlert(
        title: values['title']!,
        message: values['message']!,
        riskLevel: values['risk_level']!,
        stationName: values['station_name'],
      );
      if (mounted) {
        setState(() => _alerts = [alert, ..._alerts]);
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Alert published.')));
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> _deleteAlert(FloodAlert alert) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete alert?'),
        content: Text('“${alert.title}” will be removed.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() {
      _isSaving = true;
      _error = null;
    });
    try {
      await widget.api.deleteAlert(alert.id);
      if (mounted) {
        setState(() => _alerts.removeWhere((item) => item.id == alert.id));
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isAdmin = widget.user.isAdmin;
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
                    'Alerts',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: const Color(0xFF16313B),
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Flood notifications published by the monitoring team.',
                    style: TextStyle(color: Color(0xFF687D86)),
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Refresh alerts',
              onPressed: _isLoading || _isSaving ? null : _loadAlerts,
              icon: const Icon(Icons.refresh),
            ),
            if (isAdmin)
              FilledButton.icon(
                onPressed: _isSaving ? null : _createAlert,
                icon: const Icon(Icons.add_alert_outlined),
                label: const Text('Create alert'),
              ),
          ],
        ),
        if (!isAdmin) ...[
          const SizedBox(height: 12),
          const Text(
            'Alert creation and deletion are available to admin users.',
            style: TextStyle(color: Color(0xFF687D86), fontSize: 12),
          ),
        ],
        const SizedBox(height: 16),
        if (_error != null) _InlineError(message: _error!),
        Expanded(child: _buildBody()),
      ],
    );
  }

  Widget _buildBody() {
    if (_isLoading && _alerts.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _alerts.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.cloud_off_outlined,
              size: 40,
              color: Color(0xFF83949C),
            ),
            const SizedBox(height: 12),
            Text(_error!, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _loadAlerts,
              icon: const Icon(Icons.refresh),
              label: const Text('Try again'),
            ),
          ],
        ),
      );
    }
    if (_alerts.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.notifications_none, size: 42, color: Color(0xFF83949C)),
            SizedBox(height: 12),
            Text('No alerts have been published.'),
          ],
        ),
      );
    }

    return ListView.separated(
      itemCount: _alerts.length,
      separatorBuilder: (context, index) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        final alert = _alerts[index];
        return _AlertCard(
          alert: alert,
          canDelete: widget.user.isAdmin,
          onDelete: _isSaving ? null : () => _deleteAlert(alert),
        );
      },
    );
  }
}

class _AlertCard extends StatelessWidget {
  const _AlertCard({
    required this.alert,
    required this.canDelete,
    required this.onDelete,
  });

  final FloodAlert alert;
  final bool canDelete;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Color(0xFFE4EBEF)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    alert.title,
                    style: const TextStyle(
                      color: Color(0xFF16313B),
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                RiskBadge(level: alert.riskLevel),
                if (canDelete)
                  IconButton(
                    tooltip: 'Delete alert',
                    onPressed: onDelete,
                    icon: const Icon(Icons.delete_outline),
                    color: const Color(0xFFB42318),
                  ),
              ],
            ),
            if (alert.stationName != null && alert.stationName!.isNotEmpty) ...[
              const SizedBox(height: 6),
              Row(
                children: [
                  const Icon(
                    Icons.location_on_outlined,
                    size: 16,
                    color: Color(0xFF687D86),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    alert.stationName!,
                    style: const TextStyle(color: Color(0xFF687D86)),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 10),
            Text(alert.message, style: const TextStyle(height: 1.45)),
            if (alert.createdAt != null) ...[
              const SizedBox(height: 12),
              Text(
                _formatTimestamp(alert.createdAt!),
                style: const TextStyle(color: Color(0xFF83949C), fontSize: 12),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

String _formatTimestamp(String value) {
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return value;
  final local = parsed.toLocal();
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')} '
      '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(message, style: const TextStyle(color: Color(0xFFB42318))),
    );
  }
}
