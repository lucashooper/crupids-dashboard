# Lucas's Dashboard

A beautiful, customizable personal productivity dashboard with goal tracking, time management, and streak tracking.

## Features

### 🎨 Customization
- **Editable Dashboard Title**: Click the title to rename it to anything you want (e.g., "Lucas's Dashboard")
- **Profile Picture**: Upload your profile picture in the top right corner
- **Custom Wake/Sleep Times**: Set your own schedule in settings (click the ⚙️ icon)

### ⏰ Time Management
- **Interactive Day Ring**: Click the center circle to start your day and begin tracking time
- **Custom Schedule**: Configure your wake and sleep times to match your routine
- **Visual Progress**: Ring changes color throughout the day showing your progress

### ✅ Task Management
- **Today's Tasks**: Manage your daily goals with checkboxes
- **Plan Tomorrow**: Queue tasks for tomorrow while you're still thinking about them
- **Drag to Tomorrow**: Drag tasks from today directly to tomorrow's list
- **Reorder Tasks**: Drag tasks within lists to reorder them

### 🎯 Priority System
Simple, clean priority indicators (click the colored dot next to any task):
- 🔴 **Red**: High priority (P1)
- 🟠 **Orange**: Medium priority (P2)
- 🟢 **Green**: Low priority (P3)
- ⚪ **White**: No priority

### 📊 Statistics & Tracking
- **Streak Tracking**: Maintain your daily completion streak
- **Total Completed Tasks**: Lifetime count of all tasks you've finished
- **Days Tracked**: How many days you've used the dashboard
- **Best Streak**: Your longest streak ever
- **Persistent Storage**: All data saved locally - survives page refresh

### 🪄 AI Polish
- Add Anthropic API key to use AI to polish your task descriptions
- Converts rough notes into clear, actionable items

## Getting Started

### Local Development

```bash
npm install
npm run dev
```

Visit `http://localhost:5173/dashboard.html`

The app runs in **local-only mode** by default: no login, everything is saved in your browser's localStorage. To turn Supabase login and cloud sync back on, set `VITE_LOCAL_ONLY=false` (in `.env` or your Netlify environment variables) and rebuild.

### Build for Production

```bash
npm run build
```

The built files will be in the `dist/` folder.

## Deployment to Netlify

### Settings

If the repository root is the project folder:
- **Build command**: `npm run build`
- **Publish directory**: `dist`

If the project is in a subdirectory:
- **Base directory**: `crupids-dashboard`
- **Build command**: `npm run build`
- **Publish directory**: `dist`

### Why It Works Now

The `netlify.toml` and `public/_redirects` files ensure:
1. The build command runs correctly
2. The site root (`/`) redirects to `/dashboard.html`
3. Netlify serves the right files from the `dist` folder

## How It Works

### Data Persistence

All data is stored in **localStorage** in your browser:
- ✅ Works offline
- ✅ No server required
- ✅ Instant sync
- ✅ Free
- ✅ Private to your device

Data includes:
- Tasks and completion status
- Priority levels
- Streak information
- Profile picture
- Custom settings (wake/sleep times, dashboard title)
- Daily start times

### Task Lifecycle

1. **Add tasks** for today or tomorrow
2. **Set priorities** by clicking the colored dot
3. **Reorder** by dragging
4. **Move to tomorrow** by dragging to the tomorrow card
5. **Complete** by checking the box
6. **Automatic rollover**: Incomplete tasks from previous days roll forward
7. **Streak calculation**: Complete all tasks to maintain your streak

### Day Management

The dashboard tracks each day independently:
- Click the center ring to **start your day**
- Day state persists even if you refresh
- New days automatically rollover incomplete tasks
- Wake/sleep times control the ring's progress visualization

## Tips

- **Start each day** by clicking the ring - this initializes tracking
- **Set priorities** as you add tasks to stay focused
- **Use drag-and-drop** to quickly reorganize or defer tasks
- **Check settings** to view your stats and adjust your schedule
- **Upload a profile picture** to personalize your dashboard
- Tasks automatically save when you make changes

## Technical Stack

- Pure HTML/CSS/JavaScript (no frameworks)
- Vite for building
- localStorage for data persistence
- Modern CSS with backdrop filters and animations

## Browser Support

Works in all modern browsers that support:
- localStorage
- CSS backdrop-filter
- Drag and drop API
- ES6+ JavaScript

## License

Personal use - customize as you like!
