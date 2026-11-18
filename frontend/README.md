# Godavari Flood Monitoring System

Flutter Web frontend for the Godavari Flood Monitoring and Management System.
The app reads flood data from the Node.js REST API and does not connect to
MySQL directly.

## Run in Chrome

Start the backend at `http://localhost:5000`, then run:

```powershell
cd frontend
flutter pub get
flutter run -d chrome
```

The default API base URL is `http://localhost:5000/api`. To override it:

```powershell
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:5000/api
```

## Structure

- `lib/models/` contains API response models.
- `lib/services/api_service.dart` contains the configurable API base URL and
  REST client.
- `lib/screens/` contains login, dashboard, flood monitoring, and alert screens.
- `lib/widgets/` contains shared risk, statistic, and alert-form widgets.

The login token is kept in memory by the API service for the current app
session and cleared on logout. The backend must have an admin user seeded
before admin credentials can sign in.
