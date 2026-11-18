import 'package:material_ui/material_ui.dart';

class AlertFormDialog extends StatefulWidget {
  const AlertFormDialog({super.key});

  @override
  State<AlertFormDialog> createState() => _AlertFormDialogState();
}

class _AlertFormDialogState extends State<AlertFormDialog> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _messageController = TextEditingController();
  final _stationController = TextEditingController();
  String _riskLevel = 'LOW';

  @override
  void dispose() {
    _titleController.dispose();
    _messageController.dispose();
    _stationController.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.of(context).pop(<String, String?>{
      'title': _titleController.text.trim(),
      'message': _messageController.text.trim(),
      'risk_level': _riskLevel,
      'station_name': _stationController.text.trim().isEmpty
          ? null
          : _stationController.text.trim(),
    });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Create flood alert'),
      content: SizedBox(
        width: 440,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: _titleController,
                  maxLength: 150,
                  decoration: const InputDecoration(labelText: 'Title'),
                  validator: (value) => value == null || value.trim().isEmpty
                      ? 'Enter an alert title.'
                      : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _messageController,
                  minLines: 3,
                  maxLines: 5,
                  decoration: const InputDecoration(labelText: 'Message'),
                  validator: (value) => value == null || value.trim().isEmpty
                      ? 'Enter an alert message.'
                      : null,
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  initialValue: _riskLevel,
                  decoration: const InputDecoration(labelText: 'Risk level'),
                  items: const [
                    DropdownMenuItem(value: 'LOW', child: Text('Low')),
                    DropdownMenuItem(
                      value: 'MODERATE',
                      child: Text('Moderate'),
                    ),
                    DropdownMenuItem(value: 'HIGH', child: Text('High')),
                  ],
                  onChanged: (value) {
                    if (value != null) setState(() => _riskLevel = value);
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _stationController,
                  decoration: const InputDecoration(
                    labelText: 'Station (optional)',
                    hintText: 'e.g. Jeeraguda',
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton.icon(
          onPressed: _submit,
          icon: const Icon(Icons.send_outlined),
          label: const Text('Publish alert'),
        ),
      ],
    );
  }
}
