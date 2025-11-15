import React from 'react';
import { ActivityIndicator, View, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../contexts/AuthContext';
import LandingScreen from '../screens/LandingScreen';
import WorkspaceScreen from '../screens/WorkspaceScreen';
import ArticlesScreen from '../screens/ArticlesScreen';
import CustomerOrdersScreen from '../screens/customer/CustomerOrdersScreen';
import DriverDashboardScreen from '../screens/driver/DriverDashboardScreen';
import DriverLeaderboardScreen from '../screens/driver/DriverLeaderboardScreen';
import DriverProfileScreen from '../screens/driver/DriverProfileScreen';
import DriverOnboardingScreen from '../screens/driver/DriverOnboardingScreen';
import FuelMonitorScreen from '../screens/fuel/FuelMonitorScreen';
import FleetViewScreen from '../screens/fleet/FleetViewScreen';
import AdminOrdersScreen from '../screens/admin/AdminOrdersScreen';
import StockWorkspaceScreen from '../screens/admin/StockWorkspaceScreen';
import CostsWorkspaceScreen from '../screens/admin/CostsWorkspaceScreen';
import FinanceWorkspaceScreen from '../screens/admin/FinanceWorkspaceScreen';
import AiWorkspaceScreen from '../screens/admin/AiWorkspaceScreen';
import ReportsWorkspaceScreen from '../screens/admin/ReportsWorkspaceScreen';
import NotificationsWorkspaceScreen from '../screens/admin/NotificationsWorkspaceScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function BootScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fef9f2', gap: 12 }}>
      <ActivityIndicator size="large" color="#f97316" />
      <Text style={{ color: '#0f172a', fontWeight: '600' }}>Warming up Arise &amp; Shine...</Text>
    </View>
  );
}

function PublicStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Landing" component={LandingScreen} />
    </Stack.Navigator>
  );
}

const CustomerStack = createNativeStackNavigator();

function CustomerOrdersStack() {
  return (
    <CustomerStack.Navigator screenOptions={{ headerShown: false }}>
      <CustomerStack.Screen name="CustomerOrdersHome" component={CustomerOrdersScreen} />
    </CustomerStack.Navigator>
  );
}

function DefaultTabs({ role }: { role?: string }) {
  const showOrders = role === 'ADMIN' || role === 'OPS';
  const showStock = role === 'ADMIN' || role === 'OPS';
  const showCosts = role === 'ADMIN' || role === 'OPS';
  const showFinance = role === 'ADMIN';
  const showAI = role === 'ADMIN';
  const showReports = role === 'ADMIN' || role === 'OPS';
  const showNotifications = role === 'ADMIN';
  const showFuel = role === 'FUEL' || role === 'ADMIN';
  const showFleet = role === 'ADMIN' || role === 'OPS' || role === 'FUEL';
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0f172a',
        tabBarInactiveTintColor: '#94a3b8',
      }}
    >
      <Tab.Screen name="Workspace" component={WorkspaceScreen} />
      {showOrders && <Tab.Screen name="AdminOrders" component={AdminOrdersScreen} options={{ title: 'Orders' }} />}
      {showStock && <Tab.Screen name="Stock" component={StockWorkspaceScreen} options={{ title: 'Stock' }} />}
      {showCosts && <Tab.Screen name="Costs" component={CostsWorkspaceScreen} options={{ title: 'Costs' }} />}
      {showFinance && <Tab.Screen name="Finance" component={FinanceWorkspaceScreen} options={{ title: 'Finance' }} />}
      {showAI && <Tab.Screen name="AI" component={AiWorkspaceScreen} options={{ title: 'AI' }} />}
      {showFuel && <Tab.Screen name="FuelMonitor" component={FuelMonitorScreen} options={{ title: 'Fuel' }} />}
      {showFleet && <Tab.Screen name="FleetView" component={FleetViewScreen} options={{ title: 'Fleet' }} />}
      {showReports && <Tab.Screen name="Reports" component={ReportsWorkspaceScreen} options={{ title: 'Reports' }} />}
      {showNotifications && (
        <Tab.Screen name="Notifications" component={NotificationsWorkspaceScreen} options={{ title: 'Alerts' }} />
      )}
      <Tab.Screen name="Updates" component={ArticlesScreen} />
    </Tab.Navigator>
  );
}

function CustomerTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0f172a',
        tabBarInactiveTintColor: '#94a3b8',
      }}
    >
      <Tab.Screen name="Orders" component={CustomerOrdersStack} />
      <Tab.Screen name="Updates" component={ArticlesScreen} />
    </Tab.Navigator>
  );
}

function DriverTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0f172a',
        tabBarInactiveTintColor: '#94a3b8',
      }}
    >
      <Tab.Screen name="DriverDashboard" component={DriverDashboardScreen} options={{ title: 'Dashboard' }} />
      <Tab.Screen name="DriverLeaderboard" component={DriverLeaderboardScreen} options={{ title: 'Leaderboard' }} />
      <Tab.Screen name="DriverProfile" component={DriverProfileScreen} options={{ title: 'Profile' }} />
      <Tab.Screen name="DriverDocuments" component={DriverOnboardingScreen} options={{ title: 'Documents' }} />
      <Tab.Screen name="Updates" component={ArticlesScreen} />
    </Tab.Navigator>
  );
}

function RoleTabs() {
  const { user } = useAuth();
  if (user?.role === 'DRIVER') {
    return <DriverTabs />;
  }
  if (user?.role === 'CUSTOMER') {
    return <CustomerTabs />;
  }
  return <DefaultTabs role={user?.role} />;
}

export default function RootNavigator() {
  const { booting, user } = useAuth();
  if (booting) {
    return (
      <>
        <StatusBar style="dark" />
        <BootScreen />
      </>
    );
  }
  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      {user ? <RoleTabs /> : <PublicStack />}
    </NavigationContainer>
  );
}
