import React from 'react';
import { ActivityIndicator, View, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../contexts/AuthContext';
import LandingScreen from '../screens/LandingScreen';
import LoginScreen from '../screens/LoginScreen';
import WorkspaceScreen from '../screens/WorkspaceScreen';
import ArticlesScreen from '../screens/ArticlesScreen';
import CustomerOrdersScreen from '../screens/customer/CustomerOrdersScreen';
import DriverDashboardScreen from '../screens/driver/DriverDashboardScreen';
import DriverLeaderboardScreen from '../screens/driver/DriverLeaderboardScreen';
import DriverProfileScreen from '../screens/driver/DriverProfileScreen';
import DriverOnboardingScreen from '../screens/driver/DriverOnboardingScreen';
import FuelMonitorScreen from '../screens/fuel/FuelMonitorScreen';
import FuelHomeScreen from '../screens/fuel/FuelHomeScreen';
import FleetViewScreen from '../screens/fleet/FleetViewScreen';
import AdminOrdersScreen from '../screens/admin/AdminOrdersScreen';
import OpsHomeScreen from '../screens/ops/OpsHomeScreen';
import StockWorkspaceScreen from '../screens/admin/StockWorkspaceScreen';
import CostsWorkspaceScreen from '../screens/admin/CostsWorkspaceScreen';
import FinanceWorkspaceScreen from '../screens/admin/FinanceWorkspaceScreen';
import AiWorkspaceScreen from '../screens/admin/AiWorkspaceScreen';
import ReportsWorkspaceScreen from '../screens/admin/ReportsWorkspaceScreen';
import NotificationsWorkspaceScreen from '../screens/admin/NotificationsWorkspaceScreen';
import AuditWorkspaceScreen from '../screens/admin/AuditWorkspaceScreen';
import EmailManagementScreen from '../screens/admin/EmailManagementScreen';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

function BootScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', gap: 12 }}>
      <ActivityIndicator size="large" color="#0f172a" />
      <Text style={{ color: '#0f172a', fontWeight: '600' }}>Warming up Arise &amp; Shine...</Text>
    </View>
  );
}

function PublicStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Landing" component={LandingScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
}

const CustomerStack = createStackNavigator();

function CustomerOrdersStack() {
  return (
    <CustomerStack.Navigator screenOptions={{ headerShown: false }}>
      <CustomerStack.Screen name="CustomerOrdersHome" component={CustomerOrdersScreen} />
    </CustomerStack.Navigator>
  );
}

const tabOpts = {
  headerShown: false,
  tabBarActiveTintColor: '#0f172a',
  tabBarInactiveTintColor: '#94a3b8',
  tabBarStyle: { borderTopColor: '#e2e8f0' },
};

function AdminTabs() {
  return (
    <Tab.Navigator screenOptions={tabOpts}>
      <Tab.Screen name="Workspace" component={WorkspaceScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="AdminOrders" component={AdminOrdersScreen} options={{ title: 'Orders' }} />
      <Tab.Screen name="Stock" component={StockWorkspaceScreen} options={{ title: 'Stock' }} />
      <Tab.Screen name="Costs" component={CostsWorkspaceScreen} options={{ title: 'Costs' }} />
      <Tab.Screen name="Finance" component={FinanceWorkspaceScreen} options={{ title: 'Finance' }} />
      <Tab.Screen name="FuelMonitor" component={FuelMonitorScreen} options={{ title: 'Fuel' }} />
      <Tab.Screen name="FleetView" component={FleetViewScreen} options={{ title: 'Fleet' }} />
      <Tab.Screen name="Reports" component={ReportsWorkspaceScreen} options={{ title: 'Reports' }} />
      <Tab.Screen name="Audit" component={AuditWorkspaceScreen} options={{ title: 'Audit' }} />
      <Tab.Screen name="AI" component={AiWorkspaceScreen} options={{ title: 'AI' }} />
      <Tab.Screen name="Email" component={EmailManagementScreen} options={{ title: 'Email' }} />
      <Tab.Screen name="Updates" component={ArticlesScreen} options={{ title: 'Updates' }} />
    </Tab.Navigator>
  );
}

function OpsTabs() {
  return (
    <Tab.Navigator screenOptions={tabOpts}>
      <Tab.Screen name="OpsHome" component={OpsHomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="AdminOrders" component={AdminOrdersScreen} options={{ title: 'Orders' }} />
      <Tab.Screen name="Stock" component={StockWorkspaceScreen} options={{ title: 'Stock' }} />
      <Tab.Screen name="Costs" component={CostsWorkspaceScreen} options={{ title: 'Costs' }} />
      <Tab.Screen name="FleetView" component={FleetViewScreen} options={{ title: 'Fleet' }} />
      <Tab.Screen name="Reports" component={ReportsWorkspaceScreen} options={{ title: 'Reports' }} />
      <Tab.Screen name="Updates" component={ArticlesScreen} options={{ title: 'Updates' }} />
    </Tab.Navigator>
  );
}

function FuelTabs() {
  return (
    <Tab.Navigator screenOptions={tabOpts}>
      <Tab.Screen name="FuelHome" component={FuelHomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="FuelMonitor" component={FuelMonitorScreen} options={{ title: 'Log Fuel' }} />
      <Tab.Screen name="FleetView" component={FleetViewScreen} options={{ title: 'Fleet' }} />
      <Tab.Screen name="Updates" component={ArticlesScreen} options={{ title: 'Updates' }} />
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
  switch (user?.role) {
    case 'DRIVER':   return <DriverTabs />;
    case 'CUSTOMER': return <CustomerTabs />;
    case 'FUEL':     return <FuelTabs />;
    case 'OPS':      return <OpsTabs />;
    default:         return <AdminTabs />;
  }
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
