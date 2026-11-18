import 'package:material_ui/material_ui.dart';

class StatCard extends StatelessWidget {
  const StatCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.accent,
    this.caption,
    super.key,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color accent;
  final String? caption;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Card(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFFE4EBEF)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  height: 40,
                  width: 40,
                  decoration: BoxDecoration(
                    color: accent.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(icon, color: accent, size: 21),
                ),
                const Spacer(),
                Icon(
                  Icons.trending_up,
                  size: 18,
                  color: accent.withValues(alpha: 0.7),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: textTheme.headlineSmall?.copyWith(
                color: const Color(0xFF16313B),
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 5),
            Text(
              label,
              style: textTheme.bodyMedium?.copyWith(
                color: const Color(0xFF526873),
                fontWeight: FontWeight.w600,
              ),
            ),
            if (caption != null) ...[
              const SizedBox(height: 4),
              Text(
                caption!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: textTheme.bodySmall?.copyWith(
                  color: const Color(0xFF83949C),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
