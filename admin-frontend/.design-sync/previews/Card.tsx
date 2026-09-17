import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
  Button,
  Badge,
} from "admin-frontend"

export function Default() {
  return (
    <Card style={{ width: 320 }}>
      <CardHeader>
        <CardTitle>Machine VM-104</CardTitle>
        <CardDescription>Central Station, Platform 2</CardDescription>
        <CardAction>
          <Badge variant="secondary">Online</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p style={{ margin: 0 }}>
          Stock level is healthy across all slots. Last restocked 2 days ago.
        </p>
      </CardContent>
      <CardFooter>
        <Button variant="outline" size="sm">
          View details
        </Button>
      </CardFooter>
    </Card>
  )
}

export function Compact() {
  return (
    <Card size="sm" style={{ width: 260 }}>
      <CardHeader>
        <CardTitle>Revenue today</CardTitle>
      </CardHeader>
      <CardContent>
        <p style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>$1,284</p>
      </CardContent>
    </Card>
  )
}
