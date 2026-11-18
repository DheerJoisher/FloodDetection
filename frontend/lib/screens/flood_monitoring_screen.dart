import 'package:material_ui/material_ui.dart';

import '../models/flood_data_page.dart';
import '../models/flood_record.dart';
import '../models/station.dart';
import '../services/api_service.dart';
import '../widgets/risk_badge.dart';

class FloodMonitoringScreen extends StatefulWidget {
  const FloodMonitoringScreen({required this.api, super.key});

  final ApiService api;

  @override
  State<FloodMonitoringScreen> createState() => _FloodMonitoringScreenState();
}

class _FloodMonitoringScreenState extends State<FloodMonitoringScreen> {
  static const _pageSize = 20;

  List<Station> _stations = [];
  List<FloodRecord> _records = [];
  String? _selectedStationId;
  DateTimeRange? _dateRange;
  String? _error;
  int _page = 1;
  int _totalPages = 0;
  int _totalRecords = 0;
  int _requestVersion = 0;
  bool _isLoading = true;
  bool _isLoadingMore = false;

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  Future<void> _loadInitial() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final stations = await widget.api.getStations();
      if (!mounted) return;
      setState(() => _stations = stations);
      await _loadRecords(reset: true);
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _error = error.message;
        });
      }
    }
  }

  Future<void> _loadRecords({required bool reset}) async {
    final requestVersion = ++_requestVersion;
    final nextPage = reset ? 1 : _page + 1;
    setState(() {
      _error = null;
      if (reset) {
        _isLoading = true;
      } else {
        _isLoadingMore = true;
      }
    });

    try {
      final FloodDataPage result = await widget.api.getFloodData(
        stationId: _selectedStationId,
        startDate: _dateRange == null ? null : _dateOnly(_dateRange!.start),
        endDate: _dateRange == null ? null : _dateOnly(_dateRange!.end),
        page: nextPage,
        limit: _pageSize,
      );
      if (!mounted || requestVersion != _requestVersion) return;
      setState(() {
        if (reset) {
          _records = result.records;
        } else {
          _records = [..._records, ...result.records];
        }
        _page = result.page;
        _totalPages = result.totalPages;
        _totalRecords = result.total;
      });
    } on ApiException catch (error) {
      if (mounted && requestVersion == _requestVersion) {
        setState(() => _error = error.message);
      }
    } finally {
      if (mounted && requestVersion == _requestVersion) {
        setState(() {
          _isLoading = false;
          _isLoadingMore = false;
        });
      }
    }
  }

  Future<void> _chooseDateRange() async {
    final now = DateTime.now();
    final range = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2010),
      lastDate: DateTime(now.year, now.month, now.day),
      initialDateRange: _dateRange,
      helpText: 'Filter flood records by date',
    );
    if (range == null || !mounted) return;
    setState(() => _dateRange = range);
    await _loadRecords(reset: true);
  }

  Future<void> _clearFilters() async {
    setState(() {
      _selectedStationId = null;
      _dateRange = null;
    });
    await _loadRecords(reset: true);
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
                    'Flood monitoring',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          color: const Color(0xFF16313B),
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Browse real readings with station and date filters.',
                    style: TextStyle(color: Color(0xFF687D86)),
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Refresh records',
              onPressed: _isLoading ? null : () => _loadRecords(reset: true),
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        const SizedBox(height: 16),
        _buildFilters(),
        const SizedBox(height: 12),
        if (_error != null && _records.isNotEmpty)
          _InlineError(message: _error!),
        Expanded(child: _buildRecords()),
        if (_records.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Showing ${_records.length} of $_totalRecords records',
                    style: const TextStyle(
                      color: Color(0xFF687D86),
                      fontSize: 12,
                    ),
                  ),
                ),
                if (_page < _totalPages)
                  OutlinedButton.icon(
                    onPressed: _isLoadingMore
                        ? null
                        : () => _loadRecords(reset: false),
                    icon: _isLoadingMore
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.expand_more),
                    label: Text(_isLoadingMore ? 'Loading' : 'Load more'),
                  ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildFilters() {
    final dateText = _dateRange == null
        ? 'Any date'
        : '${_dateOnly(_dateRange!.start)} – ${_dateOnly(_dateRange!.end)}';
    return Card(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Color(0xFFE4EBEF)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Wrap(
          spacing: 12,
          runSpacing: 12,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            SizedBox(
              width: 250,
              child: DropdownButtonFormField<String>(
                initialValue: _selectedStationId ?? '',
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Station',
                  prefixIcon: Icon(Icons.location_on_outlined),
                ),
                items: [
                  const DropdownMenuItem(
                    value: '',
                    child: Text('All stations'),
                  ),
                  for (final station in _stations)
                    DropdownMenuItem(
                      value: station.id,
                      child: Text(
                        station.label,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                onChanged: _isLoading
                    ? null
                    : (value) {
                        setState(
                          () => _selectedStationId =
                              value?.isEmpty == true ? null : value,
                        );
                        _loadRecords(reset: true);
                      },
              ),
            ),
            OutlinedButton.icon(
              onPressed: _isLoading ? null : _chooseDateRange,
              icon: const Icon(Icons.calendar_today_outlined),
              label: Text(dateText),
            ),
            TextButton.icon(
              onPressed: _isLoading ? null : _clearFilters,
              icon: const Icon(Icons.filter_alt_off_outlined),
              label: const Text('Clear'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRecords() {
    if (_isLoading && _records.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _records.isEmpty) {
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
              onPressed: _loadInitial,
              icon: const Icon(Icons.refresh),
              label: const Text('Try again'),
            ),
          ],
        ),
      );
    }
    if (_records.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.search_off, size: 40, color: Color(0xFF83949C)),
            SizedBox(height: 12),
            Text('No flood records match these filters.'),
          ],
        ),
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 760) {
          return ListView.separated(
            itemCount: _records.length,
            separatorBuilder: (context, index) => const SizedBox(height: 10),
            itemBuilder: (context, index) =>
                _FloodRecordCard(record: _records[index]),
          );
        }
        return Card(
          color: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
            side: const BorderSide(color: Color(0xFFE4EBEF)),
          ),
          clipBehavior: Clip.antiAlias,
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SingleChildScrollView(
              child: DataTable(
                headingRowColor: WidgetStateProperty.all(
                  const Color(0xFFF2F7F8),
                ),
                columns: const [
                  DataColumn(label: Text('Date')),
                  DataColumn(label: Text('Station')),
                  DataColumn(label: Text('Water level'), numeric: true),
                  DataColumn(label: Text('Discharge'), numeric: true),
                  DataColumn(label: Text('Rainfall'), numeric: true),
                  DataColumn(label: Text('Risk')),
                ],
                rows: [
                  for (final record in _records)
                    DataRow(
                      cells: [
                        DataCell(Text(_formatDate(record.date))),
                        DataCell(
                          SizedBox(
                            width: 175,
                            child: Text(
                              '${record.stationName ?? 'Station'} · ${record.stationId}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ),
                        DataCell(Text(_formatValue(record.waterlevel))),
                        DataCell(Text(_formatValue(record.discharge))),
                        DataCell(Text(_formatValue(record.rainfall))),
                        DataCell(RiskBadge(level: record.riskLevel)),
                      ],
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _FloodRecordCard extends StatelessWidget {
  const _FloodRecordCard({required this.record});

  final FloodRecord record;

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
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    record.stationName ?? record.stationId,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
                RiskBadge(level: record.riskLevel),
              ],
            ),
            const SizedBox(height: 5),
            Text(
              '${record.stationId} · ${_formatDate(record.date)}',
              style: const TextStyle(color: Color(0xFF687D86), fontSize: 12),
            ),
            const Divider(height: 22),
            Wrap(
              spacing: 22,
              runSpacing: 10,
              children: [
                _CompactValue(
                  label: 'Water level',
                  value: _formatValue(record.waterlevel),
                ),
                _CompactValue(
                  label: 'Discharge',
                  value: _formatValue(record.discharge),
                ),
                _CompactValue(
                  label: 'Rainfall',
                  value: _formatValue(record.rainfall),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _CompactValue extends StatelessWidget {
  const _CompactValue({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(color: Color(0xFF687D86), fontSize: 11),
        ),
        const SizedBox(height: 3),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
      ],
    );
  }
}

String _dateOnly(DateTime value) =>
    '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';

String _formatDate(String value) {
  return DateTime.tryParse(value)?.toIso8601String().substring(0, 10) ?? value;
}

String _formatValue(double? value) => value?.toStringAsFixed(2) ?? '—';

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(message, style: const TextStyle(color: Color(0xFFB42318))),
    );
  }
}
