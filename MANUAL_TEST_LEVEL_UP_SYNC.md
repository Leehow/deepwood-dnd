# Manual Test Procedure: Real-time Character Level Up Synchronization

## Prerequisites ✅
- Frontend running on http://localhost:5174/
- Backend running on http://localhost:8174/
- Database is accessible and has test data
- You have a campaign with at least one character

## Test Setup

### Step 1: Open Two Browser Windows
1. **Browser 1 (DM View)**:
   - Open Chrome/Firefox in normal mode
   - Navigate to http://localhost:5174/
   - Login as DM account
   - Go to Campaign DM page: `/campaign/{campaign-id}/dm`

2. **Browser 2 (Player View)**:
   - Open Chrome/Firefox in incognito/private mode
   - Navigate to http://localhost:5174/
   - Login as player account
   - Go to Campaign player page: `/campaign/{campaign-id}/player`

### Step 2: Verify Initial State
1. In DM View:
   - Check character list in left panel shows current levels
   - Check map tokens show current HP values
   - Open browser DevTools Console (F12)
   - No errors should be present

2. In Player View:
   - Select a character to level up
   - Note current level, HP, ability scores

## Test Execution

### Test Case 1: Basic Level Up
1. **Player Action**:
   - Click on character in roster
   - Click "Level Up" button
   - Select class for level up
   - Complete level up process
   - Submit the form

2. **Expected Results in DM View**:
   - ✅ Notification appears in top-right corner showing:
     - Character name
     - New level
     - Class
     - Max HP
     - Ability scores (if changed)
   - ✅ Character list automatically updates with new level
   - ✅ Map token (if present) updates HP display
   - ✅ Notification auto-dismisses after 8 seconds
   - ✅ Progress bar animation shows time remaining

3. **Console Verification**:
   ```javascript
   // In DM browser console, you should see:
   // [WebSocket] Received message: {type: "character_level_up", data: {...}}
   // [CharacterPanel] Character level up received: [name] -> Level [X]
   // [LevelUpNotification] Received level up event: {...}
   ```

### Test Case 2: Multiple Characters
1. **Player Actions**:
   - Level up Character A
   - Wait 2 seconds
   - Level up Character B

2. **Expected Results in DM View**:
   - ✅ Two notifications stack vertically
   - ✅ Each notification can be dismissed independently
   - ✅ Character list shows both updates
   - ✅ Both tokens update on map

### Test Case 3: Multiclass Level Up
1. **Player Action**:
   - Select a character with multiclass capability
   - Level up choosing a different class
   - Complete the process

2. **Expected Results in DM View**:
   - ✅ Notification shows correct new class
   - ✅ HP calculation reflects multiclass rules
   - ✅ Character panel shows updated class levels

### Test Case 4: Network Resilience
1. **Test Disconnect**:
   - In DM browser DevTools, go to Network tab
   - Set to "Offline"
   - Player levels up a character
   - Set back to "Online"

2. **Expected Results**:
   - ✅ WebSocket automatically reconnects
   - ✅ Any missed updates are NOT shown (intentional)
   - ✅ Manual refresh shows correct state

## Debugging

### Check WebSocket Connection
```javascript
// In browser console:
// Check if WebSocket is connected
console.log('WebSocket state:', document.querySelector('[data-ws-status]')?.dataset.wsStatus);
```

### Monitor All Events
```javascript
// In browser console, run this to monitor events:
window.addEventListener('characterLevelUp', (e) => {
    console.log('Level Up Event:', e.detail);
});

window.addEventListener('tokenHPUpdate', (e) => {
    console.log('Token HP Update:', e.detail);
});
```

### Check Network Traffic
1. Open DevTools → Network tab
2. Filter by "WS" (WebSocket)
3. Click on the WebSocket connection
4. Go to "Messages" tab
5. Look for `character_level_up` messages

## Common Issues

### Notification Not Appearing
- Check browser console for errors
- Verify WebSocket is connected
- Ensure DM is in the same campaign
- Check if `LevelUpNotification` component is mounted

### Character List Not Updating
- Check for `characterLevelUp` events in console
- Verify `CharacterPanel` event listener is registered
- Check for API errors in Network tab

### Token HP Not Updating
- Ensure token exists on map for the character
- Check for `tokenHPUpdate` events
- Verify character_id matches between token and level up

### CSS Animation Issues
- Ensure Tailwind CSS is building correctly
- Check for CSS conflicts in DevTools
- Verify animation classes are applied

## Success Criteria

✅ **All tests pass if**:
1. DM receives real-time notifications for all level ups
2. Character list updates without manual refresh
3. Map tokens reflect new HP values
4. No console errors during the process
5. Notifications display correct information
6. Auto-dismiss works with progress bar animation
7. Multiple notifications can stack

## Performance Metrics

- **Notification Delay**: Should appear within 1-2 seconds
- **Character List Update**: Should refresh within 1 second
- **Token Update**: Should be immediate
- **WebSocket Message Size**: ~5-8KB per level up
- **Memory Usage**: No significant increase over time

## Test Report Template

```markdown
Date: [DATE]
Tester: [NAME]
Environment: Development

Test Results:
- [ ] Test Case 1: Basic Level Up - PASS/FAIL
- [ ] Test Case 2: Multiple Characters - PASS/FAIL
- [ ] Test Case 3: Multiclass Level Up - PASS/FAIL
- [ ] Test Case 4: Network Resilience - PASS/FAIL

Issues Found:
1. [Description of any issues]

Performance:
- Average notification delay: [X]ms
- WebSocket stability: Stable/Unstable
- Memory leaks detected: Yes/No

Notes:
[Any additional observations]
```

## Next Steps

After successful testing:
1. Test with multiple DMs in the same campaign
2. Test with 5+ simultaneous level ups
3. Test on different browsers (Safari, Edge)
4. Test on slower network connections
5. Load test with 20+ characters

## Optional: Automated Testing

For automated E2E testing, you can use Playwright:

```bash
# Create test file: tests/level-up-sync.spec.ts
npx playwright test tests/level-up-sync.spec.ts
```

The test should:
1. Open two browser contexts (DM and Player)
2. Perform level up in Player context
3. Assert notification appears in DM context
4. Verify character list updates
5. Check token HP changes