import 'package:material_ui/material_ui.dart';

class RiskBadge extends StatelessWidget {
  const RiskBadge({required this.level, super.key});

  final String level;

  @override
  Widget build(BuildContext context) {
    final normalized = level.toUpperCase();
    final (background, foreground, icon) = switch (normalized) {
      'HIGH' => (
        const Color(0xFFFFE7E5),
        const Color(0xFFB42318),
        Icons.warning_amber_rounded,
      ),
      'MODERATE' => (
        const Color(0xFFFFF1D6),
        const Color(0xFF9A6700),
        Icons.info_outline,
      ),
      _ => (
        const Color(0xFFE1F4EB),
        const Color(0xFF18794E),
        Icons.check_circle_outline,
      ),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: foreground),
          const SizedBox(width: 5),
          Text(
            normalized,
            style: TextStyle(
              color: foreground,
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.4,
            ),
          ),
        ],
      ),
    );
  }
}
